// Runs the whole relevé with the project's own AllKeyShop client. Its two
// HTTP endpoints are answered locally: no request leaves the machine.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { CATALOG_URL, createAllKeyShop, PRICES_URL } from '../src/allkeyshop.ts';
import { run } from '../src/run.ts';
import type { PricesFile } from '../src/types.ts';

const CATALOG = [
  { id: 0, name: 'No price page' },
  { id: 101, name: 'Hollow Knight Silksong' },
  { id: 102, name: 'Hollow Knight Silksong PS5' },
  { id: 103, name: 'Hollow Knight Silksong PS5 Account' },
  { id: 104, name: 'Hollow Knight Silksong Steam Account' },
  { id: 201, name: 'Grand Theft Auto Vice City' },
  { id: 202, name: 'GTA 6' },
  { id: 203, name: 'GTA 6 PS5' },
];

const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function priceHistory(productId: string, seen: string) {
  const row = (merchant: number, region: string, price: number, coupon: string | null = null) => ({
    product_id: Number(productId) * 10 + merchant, merchant_id: merchant, edition: '1', region,
    last_price: coupon ? price + 1 : price, min_discount_price: price, best_discount_code: coupon, start: seen, end: seen,
  });
  const histories: Record<string, unknown[]> = {
    '101': [row(1, '1', 19.5), row(2, '2', 7.53, 'AKSGAME'), row(5, '2', 8.1)],
    '102': [row(3, '3', 14.99), row(4, '3', 19.99)],
    '203': [row(4, '3', 79.99)],
  };
  return {
    officialMerchants: '1,3,4',
    history: histories[productId] ?? [],
    editions: { '1': { id: '1', name: 'Standard Edition' } },
    regions: { '1': { id: '1', name: 'GLOBAL' }, '2': { id: '2', name: 'EU Steam' }, '3': { id: '3', name: 'PSN' } },
    merchants: {
      '1': { id: '1', name: 'Steam' }, '2': { id: '2', name: 'Gameseal' }, '3': { id: '3', name: 'PS Store US' },
      '4': { id: '4', name: 'PS Store FR' }, '5': { id: '5', name: 'Eneba' },
    },
    lower_official_price: { merchant_id: 1, price: '14.99', last_update: seen },
    lower_keyshops_price: { merchant_id: 2, price: '6.20', last_update: seen },
  };
}

describe('end-to-end relevé with the built-in AllKeyShop client', () => {
  let root = '';
  let cacheDir = '';
  const calls = { catalog: 0, prices: [] as string[] };
  let blocked = false;
  const seen = utc(new Date(Date.now() - 3600_000));

  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (blocked) return new Response('blocked', { status: 403 });
    if (url === CATALOG_URL) {
      calls.catalog++;
      return new Response(JSON.stringify({ status: 'success', games: CATALOG }), { status: 200 });
    }
    if (url.startsWith(`${PRICES_URL}?`)) {
      const params = new URL(url).searchParams;
      assert.equal(params.get('currency'), 'EUR');
      assert.equal(params.get('database'), 'allkeyshop.com');
      const id = params.get('normalised_name') ?? '';
      calls.prices.push(id);
      return new Response(JSON.stringify(priceHistory(id, seen)), { status: 200 });
    }
    throw new Error(`unexpected request in test: ${url}`);
  }) as typeof fetch;

  const source = () => createAllKeyShop({ currency: 'eur', cacheDir, fetchImpl: fakeFetch, retryDelayMs: 0 });

  before(async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'wishlist-prix-test-'));
    cacheDir = join(tmp, 'cache');
    root = await mkdtemp(join(tmp, 'project-'));
    await writeFile(join(root, 'wishlist.json'), JSON.stringify({
      games: [
        { title: 'Hollow Knight: Silksong', platforms: ['pc', 'ps5'], targetPrice: 10, priority: 3 },
        { title: 'GTA VI', platforms: ['ps5'], targetPrice: 60 },
        { title: 'Grand Theft Auto VI', id: 'gta-nom-long', platforms: ['pc'], targetPrice: 60 },
      ],
    }));
  });

  it('prices trusted matches, skips doubtful ones and raises one alert', async () => {
    const lines: string[] = [];
    const { file, alerts, failed } = await run({ root, dryRun: true, delayMs: 0, source: source(), log: (l) => lines.push(l) });
    assert.equal(failed, false);

    const silksong = file.games.find((g) => g.id === 'hollow-knight-silksong');
    const pc = silksong?.results.find((r) => r.platform === 'pc');
    const ps5 = silksong?.results.find((r) => r.platform === 'ps5');
    assert.equal(pc?.matchedName, 'Hollow Knight Silksong');
    assert.deepEqual(pc?.offers.map((o) => [o.store, o.price, o.kind, o.coupon]), [
      ['Gameseal', 7.53, 'revendeur', 'AKSGAME'], ['Eneba', 8.1, 'revendeur', null], ['Steam', 19.5, 'officiel', null],
    ]);
    assert.equal(pc?.historicalLow?.official?.price, 14.99);
    assert.equal(ps5?.matchedName, 'Hollow Knight Silksong PS5');
    assert.equal(ps5?.excludedByRegion, 1, 'PS Store US is skipped');
    assert.deepEqual(ps5?.offers.map((o) => o.store), ['PS Store FR']);
    assert.equal(silksong?.best?.store, 'Gameseal');
    assert.equal(silksong?.bestOfficial?.store, 'Steam');

    const gta = file.games.find((g) => g.id === 'gta-vi');
    assert.equal(gta?.results[0]?.matchedName, 'GTA 6 PS5', 'roman numerals match digits');
    assert.equal(gta?.best?.price, 79.99);

    const longName = file.games.find((g) => g.id === 'gta-nom-long');
    assert.equal(longName?.results[0]?.match, 'doubtful');
    assert.equal(longName?.best, null);
    assert.ok(!calls.prices.includes('201'), 'a doubtful match is never priced');

    assert.deepEqual(alerts.map((a) => [a.gameId, a.offer.price]), [['hollow-knight-silksong', 7.53]]);
    assert.ok(lines.some((l) => l.includes('non envoyée')));
    const written = JSON.parse(await readFile(join(root, 'docs', 'data', 'prices.json'), 'utf8')) as PricesFile;
    assert.equal(written.games.find((g) => g.id === 'hollow-knight-silksong')?.alert?.price, 7.53);
  });

  it('reuses the cached catalog and does not alert twice for the same price', async () => {
    const { alerts } = await run({ root, dryRun: true, delayMs: 0, source: source(), log: () => {} });
    assert.equal(alerts.length, 0);
    assert.equal(calls.catalog, 1, 'catalog downloaded once, then read from the cache');
  });

  it('keeps the last prices when every request fails', async () => {
    blocked = true;
    const { file, alerts, failed } = await run({ root, dryRun: true, delayMs: 0, source: source(), log: () => {} });
    assert.equal(failed, true);
    assert.equal(alerts.length, 0);
    const silksong = file.games.find((g) => g.id === 'hollow-knight-silksong');
    assert.equal(silksong?.best?.price, 7.53);
    assert.match(silksong?.error ?? '', /HTTP 403/);
    assert.equal(silksong?.alert?.price, 7.53, 'alert state survives a failed run');
  });
});
