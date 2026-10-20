// Wishlist data and the worker's jobs, end to end on a real PostgreSQL
// (PGlite) with AllKeyShop and Discord answered locally.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { DB } from '../src/lib/db/index.ts';
import { items, meta, notifications, prices, users, type User } from '../src/lib/db/schema.ts';
import { CATALOG_URL, PRICES_URL } from '../src/lib/prices/allkeyshop.ts';
import { addItem, InputError, searchCatalog, updateItem, updatePrefs, wishlistFor } from '../src/lib/wishlist.ts';
import { dailyRun, pendingRun, processAlerts, syncCatalog, type WorkerContext } from '../src/worker/jobs.ts';
import { createTestDb, utc } from './helpers.ts';

const CATALOG = [
  { id: 101, name: 'Hollow Knight Silksong' },
  { id: 102, name: 'Hollow Knight Silksong PS5' },
  { id: 103, name: 'Hollow Knight Silksong PS5 Account' },
  { id: 201, name: 'GTA 6 PS5' },
  { id: 301, name: 'Hades 2' },
  { id: 201815201816, name: 'Elden Ring Nightreign PS5' },
];

function history(id: string, seen: string) {
  const row = (merchant: number, region: string, price: number, coupon: string | null = null) => ({
    merchant_id: merchant, edition: '1', region, last_price: price, min_discount_price: price, best_discount_code: coupon, start: seen, end: seen,
  });
  const rows: Record<string, unknown[]> = {
    '101': [row(1, '1', 19.5), row(2, '2', 7.4), row(5, '2', 8.1)],
    '102': [row(3, '3', 14.99), row(4, '4', 19.99), row(6, '4', 19.99), row(7, '5', 19.74)],
    '201': [row(8, '6', 61.2)],
    '301': [row(1, '1', 24.5)],
  };
  return {
    officialMerchants: '1,3,4,6',
    history: rows[id] ?? [],
    editions: { '1': { name: 'Standard Edition' } },
    regions: { '1': { name: 'GLOBAL' }, '2': { name: 'XBOX/PC EU' }, '3': { name: 'PSN' }, '4': { name: 'PS5' }, '5': { name: 'Playstation Wallet DE' }, '6': { name: 'Playstation Game Code EUROPE' } },
    merchants: { '1': { name: 'Steam' }, '2': { name: 'GAMESEAL' }, '3': { name: 'PS Store US' }, '4': { name: 'PS Store FR' }, '5': { name: 'Eneba' }, '6': { name: 'PS Store DE' }, '7': { name: 'Vidaplayer' }, '8': { name: 'Wyrel' } },
    lower_official_price: { merchant_id: 1, price: '14.99', last_update: seen },
  };
}

describe('wishlist and worker', () => {
  let db: DB;
  let close: () => Promise<void>;
  let enzo: User;
  let derba: User;
  const calls = { catalog: 0, prices: [] as string[], dms: [] as { to: string; body: string }[] };
  let pricesDown = false;
  let dmBlocked = false;

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === CATALOG_URL) {
      calls.catalog++;
      return Response.json({ status: 'success', games: CATALOG });
    }
    if (url.startsWith(`${PRICES_URL}?`)) {
      if (pricesDown) return new Response('down', { status: 403 });
      const id = new URL(url).searchParams.get('normalised_name') ?? '';
      calls.prices.push(id);
      return Response.json(history(id, utc(new Date(Date.now() - 3600_000))));
    }
    if (url === 'https://discord.com/api/v10/users/@me/channels') {
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bot test-bot-token');
      if (dmBlocked) return Response.json({ code: 50007, message: 'Cannot send messages to this user' }, { status: 403 });
      return Response.json({ id: `dm-${JSON.parse(String(init?.body)).recipient_id}` });
    }
    const dm = url.match(/^https:\/\/discord\.com\/api\/v10\/channels\/dm-(\d+)\/messages$/);
    if (dm) {
      calls.dms.push({ to: dm[1] as string, body: String(init?.body) });
      return Response.json({ id: 'm1' });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  const ctx = (): WorkerContext => ({ db, currency: 'eur', fetchImpl: fakeFetch, retryDelayMs: 0, delayMs: 0, botToken: 'test-bot-token', appUrl: 'https://wishlist.example.fr', log: () => {} });

  before(async () => {
    ({ db, close } = await createTestDb());
    [enzo] = (await db.insert(users).values({ name: 'Enzo', email: 'enzo@example.fr', discordId: '111111111111111111' }).returning()) as [User];
    [derba] = (await db.insert(users).values({ name: 'Derba', email: 'derba@example.fr' }).returning()) as [User];
  });
  after(() => close());

  it('syncs the catalog and searches it', async () => {
    assert.equal(await syncCatalog(ctx()), 6);
    await syncCatalog(ctx());
    const s = await searchCatalog(db, 'silksong');
    assert.deepEqual(s.map((x) => [x.title, x.pc?.id, x.ps5?.id]), [['Hollow Knight Silksong', 101, 102]]);
    assert.deepEqual((await searchCatalog(db, 'gta vi')).map((x) => x.title), ['GTA 6']);
    assert.deepEqual(await searchCatalog(db, 'h'), [], 'too short');
    assert.equal((await searchCatalog(db, 'nightreign'))[0]?.ps5?.id, 201815201816, 'ids beyond 32 bits');
  });

  it('adds games with validation, and marks their prices as pending', async () => {
    await assert.rejects(addItem(db, enzo.id, { title: 'X', pcProductId: 103, ps5ProductId: null, targetCents: null, priority: 2, edition: null, notes: '' }), InputError);
    await assert.rejects(addItem(db, enzo.id, { title: 'X', pcProductId: 102, ps5ProductId: null, targetCents: null, priority: 2, edition: null, notes: '' }), /version PC/);
    await addItem(db, enzo.id, { title: 'Hollow Knight Silksong', pcProductId: 101, ps5ProductId: 102, targetCents: 1000, priority: 3, edition: null, notes: '' });
    await addItem(db, enzo.id, { title: 'GTA 6', pcProductId: null, ps5ProductId: 201, targetCents: 6000, priority: 3, edition: null, notes: '' });
    await addItem(db, derba.id, { title: 'Hollow Knight Silksong', pcProductId: 101, ps5ProductId: null, targetCents: 700, priority: 2, edition: null, notes: '' });
    await assert.rejects(addItem(db, enzo.id, { title: 'Hollow Knight Silksong', pcProductId: 101, ps5ProductId: null, targetCents: null, priority: 2, edition: null, notes: '' }), /déjà dans ta wishlist/);
    const view = await wishlistFor(db, enzo);
    assert.equal(view.length, 2);
    assert.ok(view.every((v) => v.platforms.every((p) => p.pending)));
  });

  it('checks each product once for everyone, then alerts on the site and by Discord DM', async () => {
    assert.equal(await pendingRun(ctx()), 3);
    assert.deepEqual([...calls.prices].sort(), ['101', '102', '201'], 'Silksong PC checked once for two users');

    const view = await wishlistFor(db, enzo);
    const silk = view.find((v) => v.title.startsWith('Hollow'))!;
    assert.equal(silk.best?.store, 'GAMESEAL');
    assert.equal(silk.best?.price, 7.4);
    const ps5 = silk.platforms.find((p) => p.platform === 'ps5')!;
    assert.deepEqual(ps5.offers.map((o) => o.store), ['PS Store FR'], 'US and German stores skipped');
    assert.equal(ps5.excludedByRegion, 3);

    const enzoNotes = await db.select().from(notifications).where(eq(notifications.userId, enzo.id));
    assert.match(enzoNotes[0]?.title ?? '', /^Hollow Knight Silksong : 7,40/);
    assert.equal(enzoNotes.length, 1, 'only Silksong is under its target (GTA 6 is at 61,20 €)');
    assert.equal(calls.dms.length, 1);
    assert.equal(calls.dms[0]?.to, '111111111111111111');
    assert.deepEqual(JSON.parse(calls.dms[0]!.body).allowed_mentions, { parse: [] });

    const derbaNotes = await db.select().from(notifications).where(eq(notifications.userId, derba.id));
    assert.equal(derbaNotes.length, 0, 'Derba’s target (7 €) is not reached');
    assert.equal(await pendingRun(ctx()), 0, 'nothing left to check');
  });

  it('does not alert twice, and alerts again after the target changes', async () => {
    await processAlerts(ctx());
    assert.equal((await db.select().from(notifications).where(eq(notifications.userId, enzo.id))).length, 1);
    const [gta] = await db.select().from(items).where(eq(items.ps5ProductId, 201));
    await updateItem(db, enzo.id, gta!.id, { title: 'GTA 6', pcProductId: null, ps5ProductId: 201, targetCents: 6500, priority: 3, edition: null, notes: '' });
    await processAlerts(ctx());
    assert.equal((await db.select().from(notifications).where(eq(notifications.userId, enzo.id))).length, 2);
  });

  it('remembers when Discord refuses the DM, and keeps the site notification', async () => {
    dmBlocked = true;
    const [silk] = await db.select().from(items).where(eq(items.userId, derba.id));
    await db.update(users).set({ discordId: '222222222222222222' }).where(eq(users.id, derba.id));
    await updateItem(db, derba.id, silk!.id, { title: 'Hollow Knight Silksong', pcProductId: 101, ps5ProductId: null, targetCents: 900, priority: 2, edition: null, notes: '' });
    await processAlerts(ctx());
    dmBlocked = false;
    const [d] = await db.select().from(users).where(eq(users.id, derba.id));
    assert.match(d?.dmError ?? '', /rejoins le serveur Discord/);
    assert.equal((await db.select().from(notifications).where(eq(notifications.userId, derba.id))).length, 1);
  });

  it('applies each user’s rules: no key resellers for alerts', async () => {
    await updatePrefs(db, derba.id, { country: 'FR', excludeRegions: ['US'], edition: 'standard', keyshopAlerts: false, dmAlerts: false });
    const [d] = await db.select().from(users).where(eq(users.id, derba.id));
    const [view] = await wishlistFor(db, d!);
    assert.equal(view?.bestOfficial?.store, 'Steam');
    await processAlerts(ctx());
    const [silk] = await db.select().from(items).where(eq(items.userId, derba.id));
    assert.equal(silk?.alertCents, null, 'Steam at 19,50 € is above 9 €: alert re-armed');
  });

  it('keeps the last prices when AllKeyShop fails, and runs the daily job', async () => {
    pricesDown = true;
    await dailyRun(ctx());
    pricesDown = false;
    const [row] = await db.select().from(prices).where(eq(prices.productId, 101));
    assert.match(row?.error ?? '', /HTTP 403/);
    assert.ok(row?.data?.listings.length, 'previous prices kept');
    const [last] = await db.select().from(meta).where(eq(meta.key, 'lastDailyRun'));
    assert.ok(last);
    const [silk] = (await wishlistFor(db, enzo)).filter((v) => v.title.startsWith('Hollow'));
    assert.equal(silk?.platforms[0]?.error?.includes('403'), true);
    assert.equal(calls.catalog, 2, 'catalog not re-downloaded within 20 hours');
  });
});
