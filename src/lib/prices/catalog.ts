import { tokens } from './text.ts';
import type { CatalogEntry, Platform } from './types.ts';

/**
 * Game search in the AllKeyShop catalog (≈200 000 names). The catalog names
 * the PC version "<Title>" and the PS5 one "<Title> PS5"; accounts, DLCs and
 * other consoles are separate entries, never offered as the game.
 */

/** Words that mean the entry is not the base game. */
const NOT_THE_GAME = new Set([
  'account', 'compte', 'dlc', 'pack', 'pass', 'expansion', 'episode', 'season',
  'soundtrack', 'ost', 'costume', 'costumes', 'outfit', 'outfits', 'skin', 'skins',
  'upgrade', 'bundle', 'artbook', 'coins', 'points', 'currency', 'gift', 'giftcard',
  'card', 'subscription', 'membership', 'demo', 'beta', 'bonus', 'set', 'key',
]);
const OTHER_PLATFORMS = new Set(['ps4', 'ps3', 'xbox', 'switch', 'nintendo', '3ds', 'wii', 'steam', 'windows']);

export interface EntryInfo {
  /** Matching words without the platform word. */
  base: string[];
  platform: Platform | 'other';
  notTheGame: boolean;
}

export function entryInfo(name: string): EntryInfo {
  const toks = tokens(name);
  const ps5 = toks.includes('ps5');
  const base = toks.filter((t) => t !== 'ps5');
  const other = base.some((t) => OTHER_PLATFORMS.has(t));
  return {
    base,
    platform: other ? 'other' : ps5 ? 'ps5' : 'pc',
    notTheGame: base.some((t) => NOT_THE_GAME.has(t)),
  };
}

/** Words to search for; the last one may be unfinished while typing. */
export function searchWords(query: string): string[] {
  return tokens(query).filter((t) => t !== 'ps5' && t !== 'pc');
}

/** Stored next to each name: its words, space-delimited, for whole-word LIKE searches. */
export const normName = (name: string): string => ` ${tokens(name).join(' ')} `;

/** SQL LIKE patterns: whole words, except the last one which is a prefix. */
export function likePatterns(words: string[]): string[] {
  return words.map((w, i) => (i === words.length - 1 ? `% ${w}%` : `% ${w} %`));
}

export interface Suggestion {
  title: string;
  pc: CatalogEntry | null;
  ps5: CatalogEntry | null;
  exact: boolean;
}

const displayTitle = (entry: CatalogEntry, platform: Platform): string =>
  platform === 'ps5' ? entry.name.replace(/\s+ps5\s*$/i, '').trim() : entry.name.trim();

/**
 * Groups PC and PS5 entries of the same game, drops accounts, DLCs and other
 * consoles, and ranks exact names first, then those with the fewest extra words.
 */
export function suggest(query: string, candidates: CatalogEntry[], limit = 8): Suggestion[] {
  const q = searchWords(query);
  if (q.length === 0) return [];
  const last = q[q.length - 1] as string;
  const full = q.slice(0, -1);
  const groups = new Map<string, Suggestion & { extra: number }>();

  for (const c of candidates) {
    const info = entryInfo(c.name);
    if (info.platform === 'other' || info.notTheGame) continue;
    if (!full.every((w) => info.base.includes(w)) || !info.base.some((w) => w.startsWith(last))) continue;
    const key = info.base.join(' ');
    const g = groups.get(key) ?? { title: '', pc: null, ps5: null, exact: false, extra: info.base.length - q.length };
    const slot = info.platform;
    const current = g[slot];
    if (!current || c.name.length < current.name.length || (c.name.length === current.name.length && c.id < current.id)) {
      g[slot] = { id: c.id, name: c.name.trim() };
    }
    g.exact = key === q.join(' ');
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g) => ({ ...g, title: g.pc ? displayTitle(g.pc, 'pc') : displayTitle(g.ps5 as CatalogEntry, 'ps5') }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.extra - b.extra || a.title.length - b.title.length)
    .slice(0, limit)
    .map(({ title, pc, ps5, exact }) => ({ title, pc, ps5, exact }));
}
