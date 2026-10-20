import { readFile } from 'node:fs/promises';
import { slugify } from './text.ts';
import { PLATFORMS, type Platform, type Settings, type WishGame, type Wishlist } from './types.ts';

export const DEFAULT_SETTINGS: Settings = {
  currency: 'eur',
  excludeRegions: [
    'US', 'USA', 'NA', 'North America', 'LATAM', 'Latin America', 'RU', 'Russia', 'CIS',
    'Asia', 'SEA', 'India', 'Turkey', 'TR', 'Argentina', 'Brazil', 'China', 'CN', 'Japan',
    'JP', 'ROW', 'Rest of World', 'MENA',
  ],
  edition: 'standard',
  keyshopAlerts: true,
};

const MAX_GAMES = 60;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlatform = (v: unknown): v is Platform => typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);

export class WishlistError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`wishlist.json contient ${problems.length} erreur(s) :\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

export function parseWishlist(raw: unknown): Wishlist {
  const problems: string[] = [];
  if (!isRecord(raw)) throw new WishlistError(['le fichier doit contenir un objet { "settings": …, "games": [ … ] }']);

  const s = isRecord(raw.settings) ? raw.settings : {};
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (s.currency !== undefined) {
    if (typeof s.currency === 'string' && /^[a-z]{3}$/i.test(s.currency)) settings.currency = s.currency.toLowerCase();
    else problems.push('settings.currency doit être un code de devise (ex. "eur")');
  }
  if (s.excludeRegions !== undefined) {
    if (Array.isArray(s.excludeRegions) && s.excludeRegions.every((r) => typeof r === 'string')) settings.excludeRegions = s.excludeRegions;
    else problems.push('settings.excludeRegions doit être une liste de mots (ex. ["US", "RU"])');
  }
  if (s.edition !== undefined) {
    if (typeof s.edition === 'string') settings.edition = s.edition;
    else problems.push('settings.edition doit être "standard", "all" ou un mot de l’édition');
  }
  if (s.keyshopAlerts !== undefined) {
    if (typeof s.keyshopAlerts === 'boolean') settings.keyshopAlerts = s.keyshopAlerts;
    else problems.push('settings.keyshopAlerts doit valoir true ou false');
  }

  if (!Array.isArray(raw.games)) {
    problems.push('"games" doit être une liste de jeux');
    throw new WishlistError(problems);
  }
  if (raw.games.length > MAX_GAMES) problems.push(`maximum ${MAX_GAMES} jeux (il y en a ${raw.games.length})`);

  const games: WishGame[] = [];
  const ids = new Set<string>();
  raw.games.forEach((g, i) => {
    const where = `games[${i}]`;
    if (!isRecord(g)) {
      problems.push(`${where} doit être un objet`);
      return;
    }
    const title = typeof g.title === 'string' ? g.title.trim() : '';
    if (!title) {
      problems.push(`${where} : "title" est obligatoire`);
      return;
    }
    const label = `${where} (${title})`;
    const id = typeof g.id === 'string' && g.id.trim() ? slugify(g.id) : slugify(title);
    if (!id) problems.push(`${label} : impossible de créer un identifiant, ajoute "id"`);
    else if (ids.has(id)) problems.push(`${label} : identifiant "${id}" en double, ajoute un "id" différent`);
    ids.add(id);

    let platforms: Platform[] = ['pc', 'ps5'];
    if (g.platforms !== undefined) {
      if (Array.isArray(g.platforms) && g.platforms.length > 0 && g.platforms.every(isPlatform)) platforms = [...new Set(g.platforms)];
      else problems.push(`${label} : "platforms" doit contenir "pc" et/ou "ps5"`);
    }

    const search: Partial<Record<Platform, string>> = {};
    if (typeof g.search === 'string' && g.search.trim()) {
      for (const p of PLATFORMS) search[p] = g.search.trim();
    } else if (isRecord(g.search)) {
      for (const [k, v] of Object.entries(g.search)) {
        if (isPlatform(k) && typeof v === 'string' && v.trim()) search[k] = v.trim();
        else problems.push(`${label} : "search" accepte un texte ou { "pc": "…", "ps5": "…" }`);
      }
    } else if (g.search !== undefined) {
      problems.push(`${label} : "search" accepte un texte ou { "pc": "…", "ps5": "…" }`);
    }

    let targetPrice: number | null = null;
    if (g.targetPrice !== undefined && g.targetPrice !== null) {
      if (typeof g.targetPrice === 'number' && Number.isFinite(g.targetPrice) && g.targetPrice > 0) targetPrice = g.targetPrice;
      else problems.push(`${label} : "targetPrice" doit être un nombre positif (ex. 19.99) ou null`);
    }

    let priority: 1 | 2 | 3 = 2;
    if (g.priority !== undefined) {
      if (g.priority === 1 || g.priority === 2 || g.priority === 3) priority = g.priority;
      else problems.push(`${label} : "priority" doit valoir 1, 2 ou 3`);
    }

    const edition = typeof g.edition === 'string' && g.edition.trim() ? g.edition.trim() : null;
    const notes = typeof g.notes === 'string' ? g.notes.slice(0, 500) : '';
    games.push({ id, title, search, platforms, targetPrice, priority, edition, notes });
  });

  if (problems.length > 0) throw new WishlistError(problems);
  return { settings, games };
}

export async function loadWishlist(path: string): Promise<Wishlist> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new WishlistError([`fichier introuvable : ${path}`]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new WishlistError([`JSON invalide : ${e instanceof Error ? e.message : String(e)}`]);
  }
  return parseWishlist(raw);
}
