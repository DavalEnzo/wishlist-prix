import { tokens } from './text.ts';
import type { CatalogEntry, CatalogMatch, Platform } from './types.ts';

/**
 * Finds a game in the AllKeyShop catalog (≈200 000 names). The catalog names
 * the PC version "<Title>" and consoles "<Title> PS5"; accounts, DLCs and
 * packs are separate entries, which must never be taken for the game.
 */

/** Words that mean the entry is not the base game. */
const NOT_THE_GAME = new Set([
  'account', 'compte', 'dlc', 'pack', 'pass', 'expansion', 'episode', 'season',
  'soundtrack', 'ost', 'costume', 'costumes', 'outfit', 'outfits', 'skin', 'skins',
  'upgrade', 'bundle', 'artbook', 'coins', 'points', 'currency', 'gift', 'giftcard',
  'card', 'subscription', 'membership', 'demo', 'beta', 'bonus', 'set', 'key',
]);
const PLATFORM_WORDS = new Set([
  'pc', 'steam', 'windows', 'ps4', 'ps5', 'xbox', 'one', 'series', 'switch', 'nintendo',
]);

interface Entry extends CatalogEntry {
  toks: string[];
}

export interface Catalog {
  size: number;
  entries: Entry[];
  byKey: Map<string, Entry>;
}

export function indexCatalog(list: CatalogEntry[]): Catalog {
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  for (const { id, name } of list) {
    const clean = name.trim();
    const toks = tokens(clean);
    if (toks.length === 0) continue;
    const entry = { id, name: clean, toks };
    entries.push(entry);
    const key = toks.join(' ');
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return { size: entries.length, entries, byKey };
}

const isNoise = (word: string, platform: Platform): boolean =>
  NOT_THE_GAME.has(word) || (PLATFORM_WORDS.has(word) && word !== platform);

/**
 * exact: same words.
 * close: every word found, and every other candidate is a variant of the
 *   chosen one ("Hogwarts" → "Hogwarts Legacy", not its Deluxe Edition).
 * doubtful: several different games match ("The Witcher 3" → Wild Hunt,
 *   REDkit, Hearts of Stone…) or only part of the words match. Returned so
 *   the page can show what the catalog has, never used for a price.
 */
export function findInCatalog(catalog: Catalog, query: string, platform: Platform): CatalogMatch | null {
  const q = tokens(query).filter((t) => t !== platform);
  if (q.length === 0) return null;
  const want = platform === 'pc' ? q : [...q, platform];

  const exact = catalog.byKey.get(want.join(' '));
  if (exact) return { id: exact.id, name: exact.name, match: 'exact', alternatives: [] };

  const close: { e: Entry; extra: string[] }[] = [];
  let near: { e: Entry; hit: number; extra: number } | null = null;
  for (const e of catalog.entries) {
    if (platform !== 'pc' && !e.toks.includes(platform)) continue;
    const extra = e.toks.filter((t) => !want.includes(t));
    if (extra.some((t) => isNoise(t, platform))) continue;
    if (want.every((t) => e.toks.includes(t))) {
      close.push({ e, extra });
    } else if (close.length === 0) {
      const hit = q.filter((t) => e.toks.includes(t)).length;
      if (hit === 0 || hit * 2 < q.length) continue;
      if (!near || hit > near.hit || (hit === near.hit && extra.length < near.extra)) near = { e, hit, extra: extra.length };
    }
  }

  if (close.length > 0) {
    close.sort((a, b) => a.extra.length - b.extra.length || a.e.name.length - b.e.name.length);
    const best = close[0] as { e: Entry; extra: string[] };
    const others = close.filter((c) => c !== best && !best.extra.every((t) => c.extra.includes(t)));
    const alternatives = others.slice(0, 3).map((c) => c.e.name);
    return { id: best.e.id, name: best.e.name, match: others.length > 0 ? 'doubtful' : 'close', alternatives };
  }
  if (near) return { id: near.e.id, name: near.e.name, match: 'doubtful', alternatives: [] };
  return null;
}
