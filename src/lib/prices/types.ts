export type Platform = 'pc' | 'ps5';
export type Kind = 'officiel' | 'revendeur';

export const PLATFORMS: readonly Platform[] = ['pc', 'ps5'];
export const PLATFORM_LABEL: Record<Platform, string> = { pc: 'PC', ps5: 'PS5' };

/** Per-user rules deciding which offers count. */
export interface OfferPrefs {
  /** Country of the user's accounts (PSN, Steam): offers locked to another country are skipped. */
  country: string;
  /** Region or store words to skip (e.g. "US" drops "PS Store US"). */
  excludeRegions: string[];
  /** "standard", "all", or a keyword found in the edition name. */
  edition: string;
  /** When false, only official stores can trigger an alert. */
  keyshopAlerts: boolean;
}

export const DEFAULT_PREFS: OfferPrefs = {
  country: 'FR',
  excludeRegions: [
    'US', 'USA', 'NA', 'North America', 'LATAM', 'Latin America', 'RU', 'Russia', 'CIS',
    'Asia', 'SEA', 'India', 'Turkey', 'TR', 'Argentina', 'Brazil', 'China', 'CN', 'Japan',
    'JP', 'ROW', 'Rest of World', 'MENA',
  ],
  edition: 'standard',
  keyshopAlerts: true,
};

/* ---------- AllKeyShop data ---------- */

export interface CatalogEntry {
  id: number;
  name: string;
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

/* ---------- What the site shows ---------- */

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

export interface PlatformOffers {
  platform: Platform;
  productId: number;
  productName: string;
  url: string;
  /** Not checked yet: the worker picks it up within a minute. */
  pending: boolean;
  checkedAt: string | null;
  error: string | null;
  offers: Offer[];
  excludedByRegion: number;
  editionFallback: boolean;
  historicalLow: Lows | null;
}
