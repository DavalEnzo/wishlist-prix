import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideAlerts, discordPayloads, isDiscordWebhook, sendDiscord } from '../src/alerts.ts';
import { parseCatalog, parsePrices } from '../src/allkeyshop.ts';
import { findInCatalog, indexCatalog } from '../src/catalog.ts';
import { buildOffers, classify, filterEdition, isExcluded, pickBest } from '../src/offers.ts';
import { comparatorUrl, tokens, words } from '../src/text.ts';
import { DEFAULT_SETTINGS, parseWishlist, WishlistError } from '../src/wishlist.ts';
import type { GameResult, Listing, Offer, PlatformResult } from '../src/types.ts';

const offer = (p: Partial<Offer>): Offer => ({
  platform: 'pc', store: 'Steam', kind: 'officiel', price: 20, listPrice: null, coupon: null,
  edition: 'Standard Edition', region: 'Steam', lastSeen: '2026-10-20 06:00:00', ...p,
});
const listing = (p: Partial<Listing>): Listing => ({
  merchant: 'Steam', official: true, edition: 'Standard Edition', region: 'GLOBAL', price: 20,
  listPrice: null, coupon: null, lastSeen: '2026-10-20 06:00:00', ...p,
});
const platformResult = (p: Partial<PlatformResult>): PlatformResult => ({
  platform: 'pc', query: 'x', matchedName: 'x', match: 'exact', alternatives: [], url: null, offers: [],
  excludedByRegion: 0, editionFallback: false, historicalLow: null, error: null, ...p,
});
const game = (p: Partial<GameResult>): GameResult => ({
  id: 'g', title: 'Jeu', platforms: ['pc'], targetPrice: 10, priority: 2, notes: '',
  checkedAt: '2026-10-20T06:00:00.000Z', error: null, results: [], best: null, bestOfficial: null, alert: null, ...p,
});

describe('text', () => {
  it('normalises accents, apostrophes, catalog entities and roman numerals', () => {
    assert.deepEqual(tokens('Baldur&#039;s Gate 3'), ['baldurs', 'gate', '3']);
    assert.deepEqual(tokens('God of War Ragnarök'), ['god', 'of', 'war', 'ragnarok']);
    assert.deepEqual(tokens('GTA VI'), ['gta', '6']);
    assert.deepEqual(tokens('Ratchet and Clank'), tokens('Ratchet & Clank'));
    assert.deepEqual(words('Final Fantasy VII'), ['final', 'fantasy', 'vii'], 'links keep the original words');
  });
  it('builds GoClecD links matching the site pattern', () => {
    assert.equal(comparatorUrl('Hollow Knight Silksong', 'pc'), 'https://www.goclecd.fr/acheter-hollow-knight-silksong-cle-cd-comparateur-prix/');
    assert.equal(comparatorUrl('Persona 3 Reload PS5', 'ps5'), 'https://www.goclecd.fr/acheter-persona-3-reload-ps5-comparateur-prix/');
  });
});

describe('catalog search', () => {
  const catalog = indexCatalog([
    { id: '1', name: 'Hollow Knight Silksong' },
    { id: '2', name: 'Hollow Knight Silksong PS5' },
    { id: '3', name: 'Hollow Knight Silksong PS5 Account' },
    { id: '4', name: 'Hollow Knight Silksong Steam Account' },
    { id: '5', name: 'Hollow Knight Silksong Nintendo Switch 2' },
    { id: '10', name: 'Grand Theft Auto Vice City' },
    { id: '11', name: 'Grand Theft Auto V' },
    { id: '12', name: 'GTA 6' },
    { id: '13', name: 'GTA 6 PS5' },
    { id: '20', name: 'Persona 3 Reload DLC Pack' },
    { id: '21', name: 'Persona 3 Reload Expansion Pass PS5' },
    { id: '22', name: 'Persona 3 Reload' },
    { id: '30', name: "Baldur's Gate 3 Digital Deluxe Edition Upgrade" },
    { id: '31', name: "Baldur's Gate 3" },
    { id: '40', name: 'The Witcher 3 Wild Hunt Complete Edition' },
    { id: '41', name: 'The Witcher 3 Wild Hunt' },
    { id: '42', name: 'The Witcher 3 Hearts of Stone' },
  ]);
  const find = (q: string, p: 'pc' | 'ps5') => findInCatalog(catalog, q, p);

  it('finds the base game per platform, ignoring punctuation', () => {
    assert.deepEqual(find('Hollow Knight: Silksong', 'pc'), { id: '1', name: 'Hollow Knight Silksong', match: 'exact', alternatives: [] });
    assert.deepEqual(find('Hollow Knight: Silksong', 'ps5'), { id: '2', name: 'Hollow Knight Silksong PS5', match: 'exact', alternatives: [] });
    assert.equal(find("Baldurs Gate 3", 'pc')?.id, '31');
  });
  it('treats roman numerals and digits alike', () => {
    assert.equal(find('GTA VI', 'ps5')?.name, 'GTA 6 PS5');
    assert.equal(find('Grand Theft Auto 5', 'pc')?.id, '11');
  });
  it('never returns an account, a DLC or another platform as the game', () => {
    assert.equal(find('Persona 3 Reload', 'pc')?.id, '22');
    assert.equal(find('Persona 3 Reload', 'ps5'), null, 'only a PS5 expansion pass exists');
  });
  it('accepts a shorter name when the other matches are only editions of it', () => {
    assert.deepEqual(find('Witcher 3 Wild Hunt', 'pc'), { id: '41', name: 'The Witcher 3 Wild Hunt', match: 'close', alternatives: [] });
  });
  it('refuses to choose between different games', () => {
    const r = find('Witcher 3', 'pc');
    assert.equal(r?.match, 'doubtful');
    assert.deepEqual(r?.alternatives, ['The Witcher 3 Hearts of Stone']);
  });
  it('flags a partial match as doubtful instead of guessing', () => {
    const r = find('Grand Theft Auto VI', 'pc');
    assert.equal(r?.match, 'doubtful');
    assert.notEqual(r?.id, '12');
    assert.equal(find('Zelda', 'pc'), null);
  });
});

describe('AllKeyShop responses', () => {
  it('validates the catalog and skips id 0', () => {
    const games = parseCatalog({ status: 'success', games: [{ id: 0, name: 'X' }, { id: '7', name: 'Seven' }, { id: 8, name: 'Eight' }] });
    assert.deepEqual(games, [{ id: '7', name: 'Seven' }, { id: '8', name: 'Eight' }]);
    assert.throws(() => parseCatalog({ status: 'error' }));
    assert.throws(() => parseCatalog({ status: 'success', games: [{ id: -1, name: 'X' }, { id: 2, name: '' }] }));
  });

  const now = Date.parse('2026-10-20T08:00:00Z');
  const tables = {
    merchants: { '1': { name: 'Steam' }, '2': { name: 'G2A' }, '3': { name: 'Kinguin' } },
    editions: { '1': { name: 'Standard Edition' } },
    regions: { '1': { name: 'GLOBAL' }, '2': { name: 'EU Steam' } },
  };
  const rec = (merchant: number, region: string, price: number, start: string, end: string, extra: object = {}) => ({
    merchant_id: merchant, edition: '1', region, last_price: price, min_discount_price: price, best_discount_code: null, start, end, ...extra,
  });

  it('keeps the newest record per listing, with coupon and official flag', () => {
    const data = parsePrices({
      ...tables,
      officialMerchants: '1',
      history: [
        rec(1, '1', 29.99, '2026-09-01 10:00:00', '2026-10-01 10:00:00'),
        rec(1, '1', 19.5, '2026-10-01 10:00:00', '2026-10-20 07:00:00'),
        rec(2, '2', 9.99, '2026-10-19 10:00:00', '2026-10-20 06:00:00', { last_price: 11.2, min_discount_price: 9.99, best_discount_code: 'AKS' }),
      ],
      lower_official_price: { merchant_id: 1, price: '14.99', last_update: '2026-03-02 10:00:00' },
      lower_keyshops_price: { merchant_id: 0, price: '0', last_update: '' },
    }, now);
    assert.deepEqual(data.listings.map((l) => [l.merchant, l.price, l.official, l.coupon, l.listPrice]), [
      ['Steam', 19.5, true, null, null],
      ['G2A', 9.99, false, 'AKS', 11.2],
    ]);
    assert.deepEqual(data.historicalLow, { official: { merchant: 'Steam', price: 14.99, lastUpdate: '2026-03-02 10:00:00' }, keyshops: null });
  });
  it('drops listings not seen for a week, and never shows an older price as current', () => {
    const data = parsePrices({
      ...tables,
      officialMerchants: '1',
      history: [
        rec(3, '2', 5, '2026-09-01 10:00:00', '2026-10-01 10:00:00'),
        rec(2, '2', 8, '2026-10-10 10:00:00', '2026-10-15 10:00:00'),
        rec(2, '2', -1, '2026-10-15 10:00:00', '2026-10-20 07:00:00'),
      ],
    }, now);
    assert.deepEqual(data.listings, []);
  });
  it('rejects malformed answers and marks stores unknown without the official list', () => {
    assert.throws(() => parsePrices({ error: 'x' }, now));
    const data = parsePrices({ ...tables, history: [rec(2, '2', 8, '2026-10-19 10:00:00', '2026-10-20 07:00:00')] }, now);
    assert.equal(data.listings[0]?.official, null);
  });
});

describe('offers', () => {
  it('uses AllKeyShop’s official flag, with a name-based fallback', () => {
    assert.equal(classify({ merchant: 'Gamesplanet', official: false }), 'revendeur');
    assert.equal(classify({ merchant: 'G2A', official: true }), 'officiel');
    assert.equal(classify({ merchant: 'PS Store FR', official: null }), 'officiel');
    assert.equal(classify({ merchant: 'Eneba', official: null }), 'revendeur');
  });
  it('excludes regions by word, including in the store name', () => {
    const ex = DEFAULT_SETTINGS.excludeRegions;
    assert.equal(isExcluded('PSN', 'PS Store US', ex), true);
    assert.equal(isExcluded('Steam ROW', 'Kinguin', ex), true);
    assert.equal(isExcluded('Latin America Steam', 'Gamivo', ex), true);
    assert.equal(isExcluded('EU Steam', 'Eneba', ex), false);
    assert.equal(isExcluded('GLOBAL', 'Instant Gaming', ex), false);
  });
  it('keeps the wanted edition and falls back to all editions', () => {
    const list = [offer({ edition: 'Deluxe Edition', price: 30 }), offer({ edition: 'Standard Edition', price: 25 })];
    assert.deepEqual(filterEdition(list, 'standard').offers.map((o) => o.price), [25]);
    assert.equal(filterEdition([list[0] as Offer], 'standard').fallback, true);
    assert.equal(filterEdition(list, 'all').offers.length, 2);
  });
  it('builds sorted, deduplicated offers and counts region exclusions', () => {
    const built = buildOffers('pc', {
      listings: [
        listing({ merchant: 'G2A', official: false, region: 'EU Steam', price: 10.5, coupon: 'AKS' }),
        listing({ merchant: 'G2A', official: false, region: 'EU Steam', price: 11 }),
        listing({ merchant: 'Kinguin', official: false, region: 'US Steam', price: 5 }),
        listing({ merchant: 'Steam', price: 19.5 }),
        listing({ merchant: 'Broken', price: 0 }),
      ],
      historicalLow: { official: null, keyshops: null },
    }, DEFAULT_SETTINGS.excludeRegions, 'standard');
    assert.equal(built.excludedByRegion, 1);
    assert.deepEqual(built.offers.map((o) => [o.store, o.price, o.kind, o.coupon]), [
      ['G2A', 10.5, 'revendeur', 'AKS'],
      ['Steam', 19.5, 'officiel', null],
    ]);
  });
  it('never picks a price from a doubtful match or a failed platform', () => {
    const results = [
      platformResult({ match: 'doubtful', offers: [offer({ price: 1 })] }),
      platformResult({ platform: 'ps5', error: 'HTTP 500', offers: [offer({ price: 2 })] }),
      platformResult({ offers: [offer({ price: 9, kind: 'revendeur' }), offer({ price: 15 })] }),
    ];
    assert.equal(pickBest(results)?.price, 9);
    assert.equal(pickBest(results, 'officiel')?.price, 15);
  });
});

describe('alerts', () => {
  const now = new Date('2026-10-20T06:41:00Z');
  const s = DEFAULT_SETTINGS;
  it('alerts once when a game goes under its target', () => {
    const first = decideAlerts([game({ best: offer({ price: 9 }) })], s, now);
    assert.equal(first.alerts.length, 1);
    assert.deepEqual(first.games[0]?.alert, { price: 9, at: now.toISOString() });
    assert.equal(decideAlerts(first.games, s, now).alerts.length, 0);
  });
  it('alerts again only for a real further drop', () => {
    assert.equal(decideAlerts([game({ best: offer({ price: 8.8 }), alert: { price: 9, at: 'x' } })], s, now).alerts.length, 0);
    const r = decideAlerts([game({ best: offer({ price: 8.4 }), alert: { price: 9, at: 'x' } })], s, now);
    assert.equal(r.alerts.length, 1);
    assert.equal(r.alerts[0]?.previousAlertPrice, 9);
  });
  it('re-arms above the target, but not when the check failed', () => {
    assert.equal(decideAlerts([game({ best: offer({ price: 12 }), alert: { price: 9, at: 'x' } })], s, now).games[0]?.alert, null);
    const failed = game({ error: 'PC : HTTP 403', best: null, alert: { price: 9, at: 'x' } });
    assert.deepEqual(decideAlerts([failed], s, now, new Set(['g'])).games[0]?.alert, { price: 9, at: 'x' });
  });
  it('uses official stores only when key reseller alerts are off', () => {
    const g = game({ best: offer({ price: 5, kind: 'revendeur' }), bestOfficial: offer({ price: 14 }) });
    assert.equal(decideAlerts([g], { ...s, keyshopAlerts: false }, now).alerts.length, 0);
    assert.equal(decideAlerts([g], s, now).alerts.length, 1);
  });
  it('builds Discord messages that cannot ping and fit the 10-embed limit', () => {
    const alerts = Array.from({ length: 12 }, (_, i) => ({
      gameId: `g${i}`, title: `@everyone Jeu ${i}`, targetPrice: 10, offer: offer({ price: 9, coupon: 'AKS' }), previousAlertPrice: null, url: null,
    }));
    const payloads = discordPayloads(alerts) as { embeds: unknown[]; allowed_mentions: { parse: unknown[] } }[];
    assert.deepEqual(payloads.map((p) => p.embeds.length), [10, 2]);
    assert.ok(payloads.every((p) => p.allowed_mentions.parse.length === 0));
  });
  it('only sends to a Discord webhook URL', async () => {
    assert.equal(isDiscordWebhook('https://discord.com/api/webhooks/123/abc-DEF_9'), true);
    assert.equal(isDiscordWebhook('https://evil.example/api/webhooks/123/abc'), false);
    const calls: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const a = { gameId: 'g', title: 'Jeu', targetPrice: 10, offer: offer({ price: 9 }), previousAlertPrice: null, url: null };
    await sendDiscord('https://discord.com/api/webhooks/1/tok', [a], fake);
    assert.equal(calls.length, 1);
    await assert.rejects(sendDiscord('https://evil.example/hook', [a], fake));
  });
});

describe('wishlist.json', () => {
  it('applies defaults and accepts search as text or per platform', () => {
    const w = parseWishlist({
      games: [
        { title: 'Hollow Knight: Silksong', targetPrice: 10 },
        { title: 'GTA VI', search: { ps5: 'GTA 6' }, platforms: ['ps5'] },
      ],
    });
    assert.equal(w.settings.edition, 'standard');
    assert.equal(w.games[0]?.id, 'hollow-knight-silksong');
    assert.deepEqual(w.games[0]?.platforms, ['pc', 'ps5']);
    assert.deepEqual(w.games[1]?.search, { ps5: 'GTA 6' });
  });
  it('reports every problem in French', () => {
    assert.throws(
      () => parseWishlist({ games: [{ title: 'A', targetPrice: -1 }, { title: 'A' }, { platforms: ['xbox'] }] }),
      (e: unknown) => e instanceof WishlistError && e.problems.length === 3,
    );
  });
});
