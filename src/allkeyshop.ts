/**
 * Minimal AllKeyShop client, written for this project (no third-party code).
 *
 * AllKeyShop has no public API. Its site uses two JSON endpoints:
 *   - the game catalog (id + name for ≈200 000 products, ≈10 MB), cached one day;
 *   - the price history of one product, with store, edition and region names.
 * Every field is validated: anything unexpected is dropped, never guessed.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInCatalog, indexCatalog, type Catalog } from './catalog.ts';
import type { CatalogEntry, Listing, Low, Lows, PriceData, PriceSource } from './types.ts';

export const CATALOG_URL = 'https://www.allkeyshop.com/api/v2/vaks.php?action=gameNames&currency=eur';
export const PRICES_URL = 'https://www.allkeyshop.com/api/price_history_api.php';

const DAY_MS = 24 * 60 * 60 * 1000;
/** AllKeyShop keeps years of history; a listing unseen for a week is gone. */
const CURRENT_MAX_AGE_MS = 7 * DAY_MS;
const MAX_CATALOG_CHARS = 60_000_000;
const MAX_PRICES_CHARS = 10_000_000;
const TIMEOUT_MS = 30_000;

export interface AllKeyShopOptions {
  currency: string;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  now?: () => number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- HTTP ---------- */

async function getJson(url: string, maxChars: number, fetchImpl: typeof fetch, retryDelayMs: number): Promise<unknown> {
  let lastError: Error = new Error('AllKeyShop ne répond pas');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      lastError = new Error(timeout ? 'AllKeyShop ne répond pas (délai dépassé)' : `réseau indisponible (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    if (!res.ok) {
      lastError = new Error(`AllKeyShop a répondu HTTP ${res.status}`);
      if (res.status >= 500 || res.status === 429) continue;
      throw lastError;
    }
    const text = await res.text();
    if (text.length > maxChars) throw new Error('réponse AllKeyShop anormalement volumineuse');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('réponse AllKeyShop illisible (pas du JSON)');
    }
  }
  throw lastError;
}

/* ---------- Catalog ---------- */

export function parseCatalog(raw: unknown): CatalogEntry[] {
  if (!isRecord(raw) || raw.status !== 'success' || !Array.isArray(raw.games)) {
    throw new Error('catalogue AllKeyShop invalide');
  }
  const games: CatalogEntry[] = [];
  let invalid = 0;
  for (const g of raw.games) {
    if (!isRecord(g)) {
      invalid++;
      continue;
    }
    const id = typeof g.id === 'string' && /^\d+$/.test(g.id) ? Number(g.id) : g.id;
    // Some entries carry id 0: they have no price page.
    if (id === 0) continue;
    if (!isId(id) || typeof g.name !== 'string' || g.name.trim() === '') {
      invalid++;
      continue;
    }
    games.push({ id: String(id), name: g.name });
  }
  if (games.length === 0 || invalid > raw.games.length * 0.1) throw new Error('catalogue AllKeyShop invalide');
  return games;
}

async function readCache(file: string, now: number): Promise<CatalogEntry[] | null> {
  try {
    const { mtimeMs } = await stat(file);
    if (mtimeMs > now || now - mtimeMs > DAY_MS) return null;
    return parseCatalog({ status: 'success', games: JSON.parse(await readFile(file, 'utf8')) });
  } catch {
    return null;
  }
}

/** Atomic write: another run never reads half a file. The cache is optional. */
async function writeCache(dir: string, file: string, games: CatalogEntry[]): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(games));
    await rename(tmp, file);
  } catch {
    await unlink(tmp).catch(() => {});
  }
}

/* ---------- Prices ---------- */

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** AllKeyShop timestamps are UTC "YYYY-MM-DD HH:MM:SS". */
function toMs(ts: unknown): number | null {
  if (typeof ts !== 'string' || !TIMESTAMP.test(ts)) return null;
  const ms = Date.parse(`${ts.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19).replace('T', ' ') === ts ? ms : null;
}

function nameIn(table: unknown, id: unknown): string {
  if (!isRecord(table) || (typeof id !== 'string' && typeof id !== 'number')) return '';
  const item = table[String(id)];
  return isRecord(item) && typeof item.name === 'string' ? item.name.trim() : '';
}

function officialIds(value: unknown): Set<number> | null {
  if (typeof value !== 'string' || !/^(\d+(,\d+)*)?$/.test(value)) return null;
  const ids = value === '' ? [] : value.split(',').map(Number);
  return ids.every(isId) ? new Set(ids) : null;
}

function parseLow(value: unknown, merchants: unknown): Low | null {
  if (!isRecord(value) || !isId(value.merchant_id)) return null;
  const price = typeof value.price === 'string' && /^\d+(\.\d+)?$/.test(value.price) ? Number(value.price) : value.price;
  if (!isPrice(price) || price === 0 || toMs(value.last_update) === null) return null;
  const merchant = nameIn(merchants, value.merchant_id);
  return merchant ? { merchant, price, lastUpdate: value.last_update as string } : null;
}

interface Candidate extends Listing {
  key: string;
  start: number;
  end: number;
}

/**
 * The history holds one record per price period. For each store, edition and
 * region, keep the newest record — and drop the listing if that newest record
 * is invalid, rather than show an older price as current.
 */
export function parsePrices(raw: unknown, now: number): PriceData {
  if (!isRecord(raw) || !Array.isArray(raw.history)) throw new Error('réponse de prix AllKeyShop invalide');
  const official = officialIds(raw.officialMerchants);
  const lastSeen = new Map<string, number>();
  const newest = new Map<string, Candidate>();

  for (const h of raw.history) {
    if (!isRecord(h) || !isId(h.merchant_id)) continue;
    const end = toMs(h.end);
    if (end === null) continue;
    const key = `${h.merchant_id}|${String(h.edition)}|${String(h.region)}`;
    lastSeen.set(key, Math.max(lastSeen.get(key) ?? 0, end));

    const start = toMs(h.start);
    const merchant = nameIn(raw.merchants, h.merchant_id);
    const edition = nameIn(raw.editions, h.edition);
    const region = nameIn(raw.regions, h.region);
    const coupon = h.best_discount_code;
    if (
      start === null || !merchant || !edition || !region || !isPrice(h.min_discount_price) ||
      (h.last_price != null && !isPrice(h.last_price)) || (coupon != null && typeof coupon !== 'string')
    ) continue;

    const known = newest.get(key);
    if (known && (known.end > end || (known.end === end && known.start >= start))) continue;
    const price = Math.round(h.min_discount_price * 100) / 100;
    newest.set(key, {
      key, start, end,
      merchant,
      official: official ? official.has(h.merchant_id) : null,
      edition,
      region,
      price,
      listPrice: isPrice(h.last_price) && h.last_price > price ? h.last_price : null,
      coupon: typeof coupon === 'string' && coupon.trim() ? coupon.trim() : null,
      lastSeen: h.end as string,
    });
  }

  const cutoff = now - CURRENT_MAX_AGE_MS;
  const listings: Listing[] = [...newest.values()]
    .filter((c) => c.end === lastSeen.get(c.key) && c.end >= cutoff)
    .map(({ key: _k, start: _s, end: _e, ...listing }) => listing);
  const historicalLow: Lows = {
    official: parseLow(raw.lower_official_price, raw.merchants),
    keyshops: parseLow(raw.lower_keyshops_price, raw.merchants),
  };
  return { listings, historicalLow };
}

/* ---------- Source ---------- */

export function createAllKeyShop(opts: AllKeyShopOptions): PriceSource {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? 3000;
  const now = opts.now ?? Date.now;
  const dir = opts.cacheDir ?? join(tmpdir(), 'wishlist-prix');
  const file = join(dir, 'catalog.json');
  let catalog: Promise<Catalog> | null = null;

  const loadCatalog = async (): Promise<Catalog> => {
    const cached = await readCache(file, now());
    if (cached) return indexCatalog(cached);
    const games = parseCatalog(await getJson(CATALOG_URL, MAX_CATALOG_CHARS, fetchImpl, retryDelayMs));
    await writeCache(dir, file, games);
    return indexCatalog(games);
  };

  return {
    async find(query, platform) {
      catalog ??= loadCatalog();
      return findInCatalog(await catalog, query, platform);
    },
    async prices(productId) {
      if (!/^\d+$/.test(productId)) throw new Error(`identifiant de produit invalide : ${productId}`);
      const url = new URL(PRICES_URL);
      url.search = new URLSearchParams({
        normalised_name: productId,
        currency: opts.currency.toUpperCase(),
        database: 'allkeyshop.com',
        v2: '1',
      }).toString();
      return parsePrices(await getJson(url.toString(), MAX_PRICES_CHARS, fetchImpl, retryDelayMs), now());
    },
  };
}
