import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alertMessage, decideAlert, discordMessage } from '../src/lib/prices/alerts.ts';
import { parseCatalog, parsePrices } from '../src/lib/prices/allkeyshop.ts';
import { entryInfo, likePatterns, normName, suggest } from '../src/lib/prices/catalog.ts';
import { buildOffers, classify, isExcluded, isOtherCountry, platformOffers } from '../src/lib/prices/offers.ts';
import { comparatorUrl, tokens, words } from '../src/lib/prices/text.ts';
import { DEFAULT_PREFS, type Listing, type Offer } from '../src/lib/prices/types.ts';

const listing = (p: Partial<Listing>): Listing => ({
  merchant: 'Steam', official: true, edition: 'Standard Edition', region: 'GLOBAL', price: 20,
  listPrice: null, coupon: null, lastSeen: '2026-10-20 06:00:00', ...p,
});
const offer = (p: Partial<Offer>): Offer => ({
  platform: 'pc', store: 'Steam', kind: 'officiel', price: 20, listPrice: null, coupon: null,
  edition: 'Standard Edition', region: 'GLOBAL', lastSeen: '2026-10-20 06:00:00', ...p,
});

describe('text', () => {
  it('normalises accents, apostrophes, entities and roman numerals', () => {
    assert.deepEqual(tokens('Baldur&#039;s Gate 3'), ['baldurs', 'gate', '3']);
    assert.deepEqual(tokens('God of War Ragnarök'), ['god', 'of', 'war', 'ragnarok']);
    assert.deepEqual(tokens('Hades II'), ['hades', '2']);
    assert.deepEqual(words('Final Fantasy VII'), ['final', 'fantasy', 'vii']);
    assert.equal(normName('Hollow Knight: Silksong'), ' hollow knight silksong ');
  });
  it('builds GoClecD links', () => {
    assert.equal(comparatorUrl('Persona 3 Reload PS5', 'ps5'), 'https://www.goclecd.fr/acheter-persona-3-reload-ps5-comparateur-prix/');
  });
});

describe('catalog search', () => {
  const candidates = [
    { id: 1, name: 'Hollow Knight Silksong' },
    { id: 2, name: 'Hollow Knight Silksong PS5' },
    { id: 3, name: 'Hollow Knight Silksong PS5 Account' },
    { id: 4, name: 'Hollow Knight Silksong Steam Account' },
    { id: 5, name: 'Hollow Knight Silksong Nintendo Switch' },
    { id: 6, name: 'Hollow Knight' },
    { id: 7, name: 'Hollow Knight Voidheart Edition PS4' },
    { id: 8, name: 'GTA 6 PS5' },
    { id: 9, name: 'Hades 2' },
  ];
  it('classifies catalog entries', () => {
    assert.deepEqual(entryInfo('Hollow Knight Silksong PS5'), { base: ['hollow', 'knight', 'silksong'], platform: 'ps5', notTheGame: false });
    assert.equal(entryInfo('Hollow Knight Silksong PS5 Account').notTheGame, true);
    assert.equal(entryInfo('Hollow Knight Silksong Nintendo Switch').platform, 'other');
  });
  it('groups PC and PS5 versions and hides accounts and other consoles', () => {
    const s = suggest('Hollow Knight: Silksong', candidates);
    assert.deepEqual(s, [{ title: 'Hollow Knight Silksong', pc: { id: 1, name: 'Hollow Knight Silksong' }, ps5: { id: 2, name: 'Hollow Knight Silksong PS5' }, exact: true }]);
  });
  it('suggests while typing (last word unfinished) and ranks the shortest first', () => {
    assert.deepEqual(suggest('hollow kni', candidates).map((s) => s.title), ['Hollow Knight', 'Hollow Knight Silksong']);
  });
  it('treats roman numerals as digits, and lists PS5-only games', () => {
    assert.deepEqual(suggest('Hades II', candidates).map((s) => s.title), ['Hades 2']);
    assert.deepEqual(suggest('GTA VI', candidates), [{ title: 'GTA 6', pc: null, ps5: { id: 8, name: 'GTA 6 PS5' }, exact: true }]);
  });
  it('builds whole-word LIKE patterns, the last one as a prefix', () => {
    assert.deepEqual(likePatterns(['hollow', 'kni']), ['% hollow %', '% kni%']);
  });
});

describe('AllKeyShop responses', () => {
  it('validates the catalog', () => {
    assert.deepEqual(parseCatalog({ status: 'success', games: [{ id: 0, name: 'X' }, { id: '7', name: ' Seven ' }, { id: 7, name: 'dup' }] }), [{ id: 7, name: 'Seven' }]);
    assert.throws(() => parseCatalog({ status: 'error' }));
  });
  const now = Date.parse('2026-10-20T08:00:00Z');
  const tables = {
    merchants: { '1': { name: 'Steam' }, '2': { name: 'G2A' } },
    editions: { '1': { name: 'Standard Edition' } },
    regions: { '1': { name: 'GLOBAL' }, '2': { name: 'EU Steam' } },
  };
  const rec = (merchant: number, region: string, price: number, start: string, end: string, extra: object = {}) => ({
    merchant_id: merchant, edition: '1', region, last_price: price, min_discount_price: price, best_discount_code: null, start, end, ...extra,
  });
  it('keeps the newest record per listing and drops stale or invalid ones', () => {
    const data = parsePrices({
      ...tables,
      officialMerchants: '1',
      history: [
        rec(1, '1', 29.99, '2026-09-01 10:00:00', '2026-10-01 10:00:00'),
        rec(1, '1', 19.5, '2026-10-01 10:00:00', '2026-10-20 07:00:00'),
        rec(2, '2', 9.99, '2026-10-19 10:00:00', '2026-10-20 06:00:00', { last_price: 11.2, best_discount_code: 'AKS' }),
        rec(2, '1', 5, '2026-09-01 10:00:00', '2026-10-01 10:00:00'),
      ],
      lower_official_price: { merchant_id: 1, price: '14.99', last_update: '2026-03-02 10:00:00' },
    }, now);
    assert.deepEqual(data.listings.map((l) => [l.merchant, l.price, l.official, l.coupon, l.listPrice]), [
      ['Steam', 19.5, true, null, null],
      ['G2A', 9.99, false, 'AKS', 11.2],
    ]);
    assert.equal(data.historicalLow.official?.price, 14.99);
    assert.equal(data.historicalLow.keyshops, null);
  });
});

describe('offers', () => {
  it('uses AllKeyShop’s official flag, with a name fallback', () => {
    assert.equal(classify({ merchant: 'G2A', official: true }), 'officiel');
    assert.equal(classify({ merchant: 'PS Store FR', official: null }), 'officiel');
    assert.equal(classify({ merchant: 'Eneba', official: null }), 'revendeur');
  });
  it('skips excluded regions and other countries’ accounts', () => {
    assert.equal(isExcluded('PSN', 'PS Store US', DEFAULT_PREFS.excludeRegions), true);
    assert.equal(isOtherCountry('PS5', 'PS Store DE', true, 'FR'), true);
    assert.equal(isOtherCountry('Playstation Wallet FR', 'Vidaplayer', false, 'FR'), false);
    assert.equal(isOtherCountry('Playstation Game Code EU in ENGLISH', 'CJS', false, 'FR'), false);
    assert.equal(isOtherCountry('Steam', 'Mmoga.de', false, 'FR'), false);
  });
  it('keeps the cheapest official offers even when resellers fill the list', () => {
    const resellers = Array.from({ length: 20 }, (_, i) => listing({ merchant: `Shop${i}`, official: false, price: 5 + i }));
    const built = buildOffers('pc', { listings: [...resellers, listing({ price: 59.99 })], historicalLow: { official: null, keyshops: null } }, DEFAULT_PREFS, 'standard');
    assert.equal(built.offers.length, 16);
    assert.equal(built.offers.at(-1)?.store, 'Steam');
  });
  it('marks a product without snapshot as pending', () => {
    const p = platformOffers('pc', { id: 1, name: 'Hades 2' }, null, DEFAULT_PREFS, null);
    assert.equal(p.pending, true);
    assert.equal(p.url, 'https://www.goclecd.fr/acheter-hades-2-cle-cd-comparateur-prix/');
    const failed = platformOffers('pc', { id: 1, name: 'Hades 2' }, { data: null, checkedAt: null, error: 'HTTP 403' }, DEFAULT_PREFS, null);
    assert.equal(failed.pending, false);
  });
});

describe('alerts', () => {
  it('alerts once under the target, again only on a real drop, and re-arms above it', () => {
    assert.deepEqual(decideAlert(1000, 900, null), { kind: 'alert', priceCents: 900 });
    assert.deepEqual(decideAlert(1000, 880, 900), { kind: 'keep' });
    assert.deepEqual(decideAlert(1000, 840, 900), { kind: 'alert', priceCents: 840 });
    assert.deepEqual(decideAlert(1000, 1200, 900), { kind: 'reset' });
    assert.deepEqual(decideAlert(null, 500, null), { kind: 'keep' });
  });
  it('builds a Discord message that cannot ping anyone', () => {
    const msg = alertMessage('@everyone Jeu', offer({ price: 9, coupon: 'AKS', kind: 'revendeur', store: 'G2A' }), 1000, null);
    assert.match(msg.body, /Code promo : AKS/);
    const payload = discordMessage(msg, 'https://www.goclecd.fr/x/', 'https://wishlist.example.fr') as { allowed_mentions: { parse: unknown[] }; embeds: { description: string }[] };
    assert.deepEqual(payload.allowed_mentions.parse, []);
    assert.match(payload.embeds[0]?.description ?? '', /wishlist\.example\.fr\/wishlist/);
  });
});
