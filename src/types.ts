export type Platform = 'pc' | 'ps5';
export type Kind = 'officiel' | 'revendeur';
export type MatchQuality = 'exact' | 'close' | 'doubtful' | 'none';

export const PLATFORMS: readonly Platform[] = ['pc', 'ps5'];
export const PLATFORM_LABEL: Record<Platform, string> = { pc: 'PC', ps5: 'PS5' };

export interface Settings {
  currency: string;
  /** Country of your accounts (PSN, Steam): offers locked to another country are skipped. */
  country: string;
  /** Region or store words to skip (e.g. "US" drops "PS Store US"). */
  excludeRegions: string[];
  /** "standard", "all", or a keyword found in the edition name. */
  edition: string;
  /** When false, only official stores can trigger an alert. */
  keyshopAlerts: boolean;
}

export interface WishGame {
  id: string;
  title: string;
  search: Partial<Record<Platform, string>>;
  platforms: Platform[];
  targetPrice: number | null;
  priority: 1 | 2 | 3;
  edition: string | null;
  notes: string;
}

export interface Wishlist {
  settings: Settings;
  games: WishGame[];
}

/* ---------- AllKeyShop data, as read by src/allkeyshop.ts ---------- */

export interface CatalogEntry {
  id: string;
  name: string;
}

export interface CatalogMatch extends CatalogEntry {
  match: MatchQuality;
  /** Other catalog names that also match, when the choice is ambiguous. */
  alternatives: string[];
}

/** One store listing still on sale (seen in the last 7 days). */
export interface Listing {
  merchant: string;
  /** From AllKeyShop's own list of official stores; null when it is missing. */
  official: boolean | null;
  edition: string;
  region: string;
  /** Best price seen, coupon included. */
  price: number;
  /** Price before coupon, when higher. */
  listPrice: number | null;
  coupon: string | null;
  lastSeen: string;
}

export interface Low {
  merchant: string;
  price: number;
  lastUpdate: string;
}

export interface Lows {
  official: Low | null;
  keyshops: Low | null;
}

export interface PriceData {
  listings: Listing[];
  historicalLow: Lows;
}

export interface PriceSource {
  find(query: string, platform: Platform): Promise<CatalogMatch | null>;
  prices(productId: string): Promise<PriceData>;
}

/* ---------- Output (docs/data/prices.json) ---------- */

export interface Offer {
  platform: Platform;
  store: string;
  kind: Kind;
  price: number;
  listPrice: number | null;
  coupon: string | null;
  edition: string;
  region: string;
  lastSeen: string;
}

export interface PlatformResult {
  platform: Platform;
  query: string;
  matchedName: string | null;
  match: MatchQuality;
  alternatives: string[];
  url: string | null;
  offers: Offer[];
  excludedByRegion: number;
  editionFallback: boolean;
  historicalLow: Lows | null;
  error: string | null;
}

export interface AlertState {
  price: number;
  at: string;
}

export interface GameResult {
  id: string;
  title: string;
  platforms: Platform[];
  targetPrice: number | null;
  priority: number;
  notes: string;
  checkedAt: string | null;
  error: string | null;
  results: PlatformResult[];
  best: Offer | null;
  bestOfficial: Offer | null;
  alert: AlertState | null;
}

export interface PricesFile {
  version: 1;
  generatedAt: string | null;
  source: string;
  settings: Pick<Settings, 'country' | 'excludeRegions' | 'edition' | 'keyshopAlerts'>;
  games: GameResult[];
}
