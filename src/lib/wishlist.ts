/**
 * Wishlist data: catalog search, items, the per-user price view and
 * notifications. Independent of Next.js; every function takes the database.
 */
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { DB } from './db/index.ts';
import { catalog, items, meta, notifications, prices, users, type User } from './db/schema.ts';
import { entryInfo, likePatterns, searchWords, suggest, type Suggestion } from './prices/catalog.ts';
import { pickBest, platformOffers, type PriceRow } from './prices/offers.ts';
import type { Offer, OfferPrefs, Platform, PlatformOffers } from './prices/types.ts';

export const MAX_ITEMS = 100;
const STALE_MS = 20 * 3600_000;

export class InputError extends Error {}

export const prefsOf = (user: User): OfferPrefs => ({
  country: user.country,
  excludeRegions: user.excludeRegions,
  edition: user.edition,
  keyshopAlerts: user.keyshopAlerts,
});

/* ---------- Catalog ---------- */

export async function catalogSize(db: DB): Promise<number> {
  const [row] = await db.select({ n: count() }).from(catalog);
  return row?.n ?? 0;
}

export async function searchCatalog(db: DB, query: string): Promise<Suggestion[]> {
  const words = searchWords(query).slice(0, 8);
  if (words.length === 0 || words.join('').length < 2) return [];
  const rows = await db
    .select({ id: catalog.id, name: catalog.name })
    .from(catalog)
    .where(and(...likePatterns(words).map((p) => sql`${catalog.norm} like ${p}`)))
    .orderBy(sql`length(${catalog.norm})`, asc(catalog.id))
    .limit(300);
  return suggest(query, rows, 8);
}

/* ---------- Items ---------- */

export interface ItemInput {
  title: string;
  pcProductId: number | null;
  ps5ProductId: number | null;
  targetCents: number | null;
  priority: number;
  edition: string | null;
  notes: string;
}

async function checkProduct(db: DB, id: number | null, platform: Platform): Promise<number | null> {
  if (id === null) return null;
  if (!Number.isSafeInteger(id) || id <= 0) throw new InputError('Jeu introuvable dans le catalogue.');
  const [row] = await db.select({ name: catalog.name }).from(catalog).where(eq(catalog.id, id)).limit(1);
  if (!row) throw new InputError('Jeu introuvable dans le catalogue.');
  const info = entryInfo(row.name);
  if (info.platform !== platform || info.notTheGame) throw new InputError(`Ce produit n’est pas la version ${platform === 'pc' ? 'PC' : 'PS5'} du jeu.`);
  return id;
}

async function validate(db: DB, input: ItemInput): Promise<ItemInput> {
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new InputError('Choisis un jeu dans la liste.');
  if (input.pcProductId === null && input.ps5ProductId === null) throw new InputError('Choisis au moins une plateforme.');
  if (![1, 2, 3].includes(input.priority)) throw new InputError('Niveau d’envie invalide.');
  return {
    title,
    pcProductId: await checkProduct(db, input.pcProductId, 'pc'),
    ps5ProductId: await checkProduct(db, input.ps5ProductId, 'ps5'),
    targetCents: input.targetCents,
    priority: input.priority,
    edition: input.edition?.trim().slice(0, 40) || null,
    notes: input.notes.trim().slice(0, 500),
  };
}

/** Asks the worker to check these products: new ones, or ones not checked for a while. */
export async function requestPrices(db: DB, productIds: number[]): Promise<void> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return;
  await db.insert(prices).values(ids.map((productId) => ({ productId }))).onConflictDoNothing();
  await db
    .update(prices)
    .set({ requestedAt: new Date() })
    .where(and(inArray(prices.productId, ids), lt(prices.checkedAt, new Date(Date.now() - STALE_MS))));
}

export async function addItem(db: DB, userId: string, raw: ItemInput): Promise<string> {
  const input = await validate(db, raw);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(items).where(eq(items.userId, userId));
  if (n >= MAX_ITEMS) throw new InputError(`Ta wishlist est limitée à ${MAX_ITEMS} jeux.`);
  const [dup] = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.userId, userId),
        or(
          input.pcProductId !== null ? eq(items.pcProductId, input.pcProductId) : sql`false`,
          input.ps5ProductId !== null ? eq(items.ps5ProductId, input.ps5ProductId) : sql`false`,
        ),
      ),
    )
    .limit(1);
  if (dup) throw new InputError('Ce jeu est déjà dans ta wishlist.');
  const [item] = await db.insert(items).values({ userId, ...input }).returning({ id: items.id });
  await requestPrices(db, [input.pcProductId, input.ps5ProductId].filter((x): x is number => x !== null));
  return (item as { id: string }).id;
}

export async function updateItem(db: DB, userId: string, itemId: string, raw: ItemInput): Promise<void> {
  const input = await validate(db, raw);
  const [current] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.userId, userId))).limit(1);
  if (!current) throw new InputError('Ce jeu n’est plus dans ta wishlist.');
  const targetChanged = current.targetCents !== input.targetCents;
  await db
    .update(items)
    .set({ ...input, ...(targetChanged ? { alertCents: null, alertAt: null } : {}) })
    .where(and(eq(items.id, itemId), eq(items.userId, userId)));
  await requestPrices(db, [input.pcProductId, input.ps5ProductId].filter((x): x is number => x !== null));
}

export async function deleteItem(db: DB, userId: string, itemId: string): Promise<void> {
  await db.delete(items).where(and(eq(items.id, itemId), eq(items.userId, userId)));
}

/* ---------- Price view ---------- */

export interface ItemView {
  id: string;
  title: string;
  priority: number;
  targetCents: number | null;
  edition: string | null;
  notes: string;
  createdAt: string;
  pcProductId: number | null;
  ps5ProductId: number | null;
  platforms: PlatformOffers[];
  best: Offer | null;
  bestOfficial: Offer | null;
}

export type ItemRow = typeof items.$inferSelect;

/** Turns stored items and price snapshots into what one user sees, with that user's rules. */
export async function buildItemViews(db: DB, rows: ItemRow[], prefs: OfferPrefs): Promise<ItemView[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.pcProductId, r.ps5ProductId]).filter((x): x is number => x !== null))];
  const products = ids.length ? await db.select({ id: catalog.id, name: catalog.name }).from(catalog).where(inArray(catalog.id, ids)) : [];
  const snapshots = ids.length ? await db.select().from(prices).where(inArray(prices.productId, ids)) : [];
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  const priceOf = new Map<number, PriceRow>(snapshots.map((s) => [s.productId, { data: s.data ?? null, checkedAt: s.checkedAt, error: s.error }]));

  return rows.map((r) => {
    const platforms: PlatformOffers[] = [];
    for (const [platform, id] of [['pc', r.pcProductId], ['ps5', r.ps5ProductId]] as const) {
      if (id === null) continue;
      platforms.push(platformOffers(platform, { id, name: nameOf.get(id) ?? r.title }, priceOf.get(id) ?? null, prefs, r.edition));
    }
    return {
      id: r.id,
      title: r.title,
      priority: r.priority,
      targetCents: r.targetCents,
      edition: r.edition,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      pcProductId: r.pcProductId,
      ps5ProductId: r.ps5ProductId,
      platforms,
      best: pickBest(platforms),
      bestOfficial: pickBest(platforms, 'officiel'),
    };
  });
}

export async function wishlistFor(db: DB, user: User): Promise<ItemView[]> {
  const rows = await db.select().from(items).where(eq(items.userId, user.id)).orderBy(desc(items.createdAt));
  return buildItemViews(db, rows, prefsOf(user));
}

export async function lastRun(db: DB): Promise<string | null> {
  const [row] = await db.select().from(meta).where(eq(meta.key, 'lastDailyRun')).limit(1);
  return typeof row?.value === 'string' ? row.value : null;
}

/* ---------- Preferences ---------- */

export async function updatePrefs(db: DB, userId: string, input: OfferPrefs & { dmAlerts: boolean }): Promise<void> {
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new InputError('Pays invalide : utilise un code à deux lettres (FR, BE, CH…).');
  const excludeRegions = [...new Set(input.excludeRegions.map((r) => r.trim()).filter(Boolean))].slice(0, 60).map((r) => r.slice(0, 40));
  const edition = input.edition.trim().slice(0, 40) || 'standard';
  await db
    .update(users)
    .set({ country, excludeRegions, edition, keyshopAlerts: input.keyshopAlerts, dmAlerts: input.dmAlerts })
    .where(eq(users.id, userId));
}

export async function updateName(db: DB, userId: string, name: string): Promise<void> {
  const n = name.trim();
  if (n.length < 1 || n.length > 40) throw new InputError('Le pseudo doit faire entre 1 et 40 caractères.');
  await db.update(users).set({ name: n }).where(eq(users.id, userId));
}

/* ---------- Notifications ---------- */

export async function unreadCount(db: DB, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function listNotifications(db: DB, userId: string, limit = 50) {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markAllRead(db: DB, userId: string): Promise<void> {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function clearNotifications(db: DB, userId: string): Promise<void> {
  await db.delete(notifications).where(eq(notifications.userId, userId));
}
