import { fold, usableMatch, words } from './text.ts';
import type { Kind, Listing, Offer, Platform, PlatformResult, PriceData } from './types.ts';

/**
 * Fallback only: AllKeyShop normally says which stores are official. When
 * that list is missing, known authorized stores are recognised by name and
 * every other store counts as a key reseller.
 */
const OFFICIAL_STORE = new RegExp(
  '\\b(' +
    [
      'steam', 'gog', 'epic', 'humble', 'fanatical', 'green ?man', 'gmg', 'gamesplanet',
      'gamersgate', 'gamesload', 'microsoft', 'xbox', 'playstation', 'ps ?store', 'nintendo',
      'ubisoft', 'ea app', 'origin', 'battle\\.?net', 'blizzard', 'rockstar', '2game',
      'wingamestore', 'dlgamer', 'nuuvem', 'indiegala', 'amazon', 'fnac', 'micromania',
      'leclerc', 'cdiscount', 'auchan', 'carrefour', 'boulanger', 'darty', 'cultura', 'gamestop',
    ].join('|') +
    ')\\b',
  'i',
);

export function classify(listing: Pick<Listing, 'merchant' | 'official'>): Kind {
  if (listing.official !== null) return listing.official ? 'officiel' : 'revendeur';
  return OFFICIAL_STORE.test(listing.merchant) ? 'officiel' : 'revendeur';
}

/** True when the region or the store name contains an excluded word ("PS Store US", "Steam ROW"). */
export function isExcluded(region: string, store: string, exclude: string[]): boolean {
  const all = [...words(region), ...words(store)];
  const set = new Set(all);
  const text = ` ${all.join(' ')} `;
  return exclude.some((entry) => {
    const w = words(entry);
    if (w.length === 0) return false;
    return w.length === 1 ? set.has(w[0] as string) : text.includes(` ${w.join(' ')} `);
  });
}

const COUNTRY_CODES = new Set([
  'fr', 'de', 'it', 'es', 'sp', 'uk', 'gb', 'pl', 'nl', 'be', 'at', 'pt', 'ch', 'se', 'dk', 'fi',
  'cz', 'hu', 'ro', 'gr', 'ie', 'sk', 'hr', 'bg', 'us', 'ca', 'au', 'br', 'mx', 'jp', 'kr', 'hk',
]);
const MULTI_COUNTRY = new Set(['eu', 'europe', 'european', 'global', 'worldwide', 'ww', 'emea']);

/**
 * True when an offer only works with an account from another country: a
 * region like "Playstation Wallet DE", or an official storefront like
 * "PS Store IT". Multi-country regions ("EU", "GLOBAL") are never locked.
 */
export function isOtherCountry(region: string, store: string, official: boolean, country: string): boolean {
  const home = country.toLowerCase();
  const locked = (w: string[]) => {
    if (w.some((t) => MULTI_COUNTRY.has(t))) return false;
    const codes = w.filter((t) => COUNTRY_CODES.has(t));
    return codes.length > 0 && !codes.includes(home);
  };
  return locked(words(region)) || (official && locked(words(store)));
}

export function filterEdition(offers: Offer[], preference: string): { offers: Offer[]; fallback: boolean } {
  const pref = fold(preference.trim());
  if (pref === '' || pref === 'all' || pref === 'toutes') return { offers, fallback: false };
  const kept = offers.filter((o) => fold(o.edition).includes(pref));
  return kept.length > 0 ? { offers: kept, fallback: false } : { offers, fallback: true };
}

const MAX_OFFERS = 15;

/** Cheapest official offers kept even when key resellers fill the list. */
const MIN_OFFICIAL = 3;

export function buildOffers(
  platform: Platform,
  data: PriceData,
  settings: { excludeRegions: string[]; country: string },
  edition: string,
): { offers: Offer[]; excludedByRegion: number; editionFallback: boolean } {
  let excludedByRegion = 0;
  const all: Offer[] = [];
  for (const l of data.listings) {
    if (!(l.price > 0)) continue;
    const kind = classify(l);
    if (isExcluded(l.region, l.merchant, settings.excludeRegions) || isOtherCountry(l.region, l.merchant, kind === 'officiel', settings.country)) {
      excludedByRegion++;
      continue;
    }
    all.push({
      platform,
      store: l.merchant,
      kind,
      price: l.price,
      listPrice: l.listPrice,
      coupon: l.coupon,
      edition: l.edition,
      region: l.region,
      lastSeen: l.lastSeen,
    });
  }
  const { offers: byEdition, fallback } = filterEdition(all, edition);
  const cheapest = new Map<string, Offer>();
  for (const o of byEdition) {
    const key = `${fold(o.store)}|${fold(o.edition)}|${fold(o.region)}`;
    const known = cheapest.get(key);
    if (!known || o.price < known.price) cheapest.set(key, o);
  }
  const byPrice = (a: Offer, b: Offer) => a.price - b.price || (a.kind === 'officiel' ? -1 : 1);
  const sorted = [...cheapest.values()].sort(byPrice);
  const top = sorted.slice(0, MAX_OFFERS);
  const officials = sorted.slice(MAX_OFFERS).filter((o) => o.kind === 'officiel').slice(0, MIN_OFFICIAL);
  return { offers: [...top, ...officials].sort(byPrice), excludedByRegion, editionFallback: fallback };
}

/** Cheapest offer across platforms whose catalog match is trustworthy. */
export function pickBest(results: PlatformResult[], kind?: Kind): Offer | null {
  let best: Offer | null = null;
  for (const r of results) {
    if (r.error || !usableMatch(r.match)) continue;
    for (const o of r.offers) {
      if (kind && o.kind !== kind) continue;
      if (!best || o.price < best.price) best = o;
    }
  }
  return best;
}
