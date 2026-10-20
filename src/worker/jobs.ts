/**
 * The worker's jobs: catalog sync, price checks (one per product, shared by
 * every user following it) and alerts. Independent of the scheduler so they
 * can be tested with a fake network.
 */
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { purgeExpired } from '../lib/auth/accounts.ts';
import type { DB } from '../lib/db/index.ts';
import { catalog, items, meta, notifications, prices, users } from '../lib/db/schema.ts';
import { sendDiscordDm } from '../lib/discord.ts';
import { decideAlert, alertMessage, discordMessage } from '../lib/prices/alerts.ts';
import { fetchCatalog, fetchPrices } from '../lib/prices/allkeyshop.ts';
import { normName } from '../lib/prices/catalog.ts';
import { toCents } from '../lib/prices/text.ts';
import { buildItemViews, prefsOf } from '../lib/wishlist.ts';

export interface WorkerContext {
  db: DB;
  currency: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  /** Pause between two AllKeyShop price requests. */
  delayMs?: number;
  botToken?: string;
  appUrl?: string;
  now?: () => Date;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowOf = (ctx: WorkerContext) => (ctx.now ?? (() => new Date()))();
const logOf = (ctx: WorkerContext) => ctx.log ?? ((line: string) => console.log(`[worker] ${line}`));

async function setMeta(db: DB, key: string, value: unknown): Promise<void> {
  await db
    .insert(meta)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: meta.key, set: { value, updatedAt: new Date() } });
}

export async function getMeta(db: DB, key: string): Promise<unknown> {
  const [row] = await db.select().from(meta).where(eq(meta.key, key)).limit(1);
  return row?.value ?? null;
}

/* ---------- Catalog ---------- */

const BATCH = 2000;

export async function syncCatalog(ctx: WorkerContext): Promise<number> {
  const log = logOf(ctx);
  log('Téléchargement du catalogue AllKeyShop…');
  const games = await fetchCatalog({ fetchImpl: ctx.fetchImpl, retryDelayMs: ctx.retryDelayMs });
  for (let i = 0; i < games.length; i += BATCH) {
    const rows = games.slice(i, i + BATCH).map((g) => ({ id: g.id, name: g.name, norm: normName(g.name) }));
    await ctx.db
      .insert(catalog)
      .values(rows)
      .onConflictDoUpdate({
        target: catalog.id,
        set: { name: sql`excluded.name`, norm: sql`excluded.norm`, updatedAt: sql`now()` },
        setWhere: sql`${catalog.name} is distinct from excluded.name`,
      });
  }
  await setMeta(ctx.db, 'catalogSyncedAt', nowOf(ctx).toISOString());
  log(`Catalogue à jour : ${games.length} produits.`);
  return games.length;
}

/* ---------- Prices ---------- */

export async function followedProductIds(db: DB): Promise<number[]> {
  const rows = await db.select({ pc: items.pcProductId, ps5: items.ps5ProductId }).from(items);
  return [...new Set(rows.flatMap((r) => [r.pc, r.ps5]).filter((x): x is number => x !== null))];
}

/** Products someone just added (or asked to re-check) and not attempted since. */
export async function pendingProductIds(db: DB, limit = 20): Promise<number[]> {
  const rows = await db
    .select({ id: prices.productId })
    .from(prices)
    .where(or(isNull(prices.attemptedAt), sql`${prices.requestedAt} > ${prices.attemptedAt}`))
    .orderBy(prices.requestedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function refreshProducts(ctx: WorkerContext, ids: number[]): Promise<{ ok: number; failed: number }> {
  const log = logOf(ctx);
  let ok = 0;
  let failed = 0;
  for (const [i, id] of ids.entries()) {
    if (i > 0 && (ctx.delayMs ?? 1500) > 0) await sleep(ctx.delayMs ?? 1500);
    const at = nowOf(ctx);
    try {
      const data = await fetchPrices(id, ctx.currency, { fetchImpl: ctx.fetchImpl, retryDelayMs: ctx.retryDelayMs, now: at.getTime() });
      await ctx.db
        .insert(prices)
        .values({ productId: id, data, checkedAt: at, attemptedAt: at, error: null })
        .onConflictDoUpdate({ target: prices.productId, set: { data, checkedAt: at, attemptedAt: at, error: null } });
      ok++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Keep the last good prices; show the error next to them.
      await ctx.db
        .insert(prices)
        .values({ productId: id, attemptedAt: at, error })
        .onConflictDoUpdate({ target: prices.productId, set: { attemptedAt: at, error } });
      log(`Produit ${id} : ${error}`);
      failed++;
    }
  }
  return { ok, failed };
}

/* ---------- Alerts ---------- */

export interface AlertReport {
  alerts: number;
  dms: number;
  dmFailures: number;
}

/**
 * For each game with a target price, compares the best offer under its
 * owner's rules with the target. An alert is a site notification, plus a
 * Discord DM when the account is linked and DMs are on.
 */
export async function processAlerts(ctx: WorkerContext, onlyUserIds?: string[]): Promise<AlertReport> {
  const report: AlertReport = { alerts: 0, dms: 0, dmFailures: 0 };
  const owners = await ctx.db
    .select()
    .from(users)
    .where(onlyUserIds?.length ? inArray(users.id, onlyUserIds) : undefined);
  for (const user of owners) {
    const rows = await ctx.db
      .select()
      .from(items)
      .where(and(eq(items.userId, user.id), or(isNotNull(items.targetCents), isNotNull(items.alertCents))));
    if (rows.length === 0) continue;
    const prefs = prefsOf(user);
    const views = await buildItemViews(ctx.db, rows, prefs);
    let dmError: string | null | undefined;
    let delivered = 0;

    for (const view of views) {
      const row = rows.find((r) => r.id === view.id);
      if (!row || view.platforms.some((p) => p.pending)) continue;
      const offer = prefs.keyshopAlerts ? view.best : view.bestOfficial;
      const decision = decideAlert(row.targetCents, offer ? toCents(offer.price) : null, row.alertCents);
      if (decision.kind === 'keep') continue;
      if (decision.kind === 'reset') {
        await ctx.db.update(items).set({ alertCents: null, alertAt: null }).where(eq(items.id, row.id));
        continue;
      }
      if (!offer || row.targetCents === null) continue;
      const msg = alertMessage(row.title, offer, row.targetCents, row.alertCents);
      const url = view.platforms.find((p) => p.platform === offer.platform)?.url ?? null;
      const at = nowOf(ctx);
      await ctx.db.insert(notifications).values({ userId: user.id, itemId: row.id, title: msg.title, body: msg.body, url, createdAt: at });
      await ctx.db.update(items).set({ alertCents: decision.priceCents, alertAt: at }).where(eq(items.id, row.id));
      report.alerts++;

      if (ctx.botToken && user.discordId && user.dmAlerts && dmError === undefined) {
        const result = await sendDiscordDm(ctx.botToken, user.discordId, discordMessage(msg, url, ctx.appUrl ?? null), ctx.fetchImpl);
        if (result.ok) {
          report.dms++;
          delivered++;
        } else {
          report.dmFailures++;
          logOf(ctx)(`MP Discord impossible pour ${user.id} : ${result.reason}`);
          // Stop trying this user for this run; remember why for the settings page.
          dmError = result.reason;
        }
      }
    }
    if (dmError !== undefined || (delivered > 0 && user.dmError)) {
      await ctx.db.update(users).set({ dmError: dmError ?? null }).where(eq(users.id, user.id));
    }
  }
  return report;
}

/* ---------- Runs ---------- */

/** Every minute: games just added get their first prices (and alerts) quickly. */
export async function pendingRun(ctx: WorkerContext): Promise<number> {
  const ids = await pendingProductIds(ctx.db);
  if (ids.length === 0) return 0;
  await refreshProducts(ctx, ids);
  const owners = await ctx.db
    .selectDistinct({ userId: items.userId })
    .from(items)
    .where(or(inArray(items.pcProductId, ids), inArray(items.ps5ProductId, ids)));
  await processAlerts(ctx, owners.map((o) => o.userId));
  return ids.length;
}

/** Once a day: catalog, every followed product, alerts, cleanup. */
export async function dailyRun(ctx: WorkerContext): Promise<void> {
  const log = logOf(ctx);
  const synced = await getMeta(ctx.db, 'catalogSyncedAt');
  if (typeof synced !== 'string' || nowOf(ctx).getTime() - Date.parse(synced) > 20 * 3600_000) {
    try {
      await syncCatalog(ctx);
    } catch (e) {
      log(`Catalogue non mis à jour : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const ids = await followedProductIds(ctx.db);
  log(`Relevé de ${ids.length} produit(s)…`);
  const { ok, failed } = await refreshProducts(ctx, ids);
  const report = await processAlerts(ctx);
  await purgeExpired(ctx.db);
  await setMeta(ctx.db, 'lastDailyRun', nowOf(ctx).toISOString());
  log(`Relevé terminé : ${ok} ok, ${failed} en échec, ${report.alerts} alerte(s), ${report.dms} MP Discord.`);
}

export async function catalogIsEmpty(db: DB): Promise<boolean> {
  const [row] = await db.select({ id: catalog.id }).from(catalog).limit(1);
  return !row;
}

