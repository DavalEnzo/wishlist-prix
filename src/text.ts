import type { MatchQuality, Platform } from './types.ts';

/** Lowercase, decode the HTML entities seen in the catalog, drop accents. */
export function fold(s: string): string {
  return s
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Plain words: "Baldur's Gate 3" → baldurs, gate, 3. */
export function words(s: string): string[] {
  return fold(s).replace(/['’‘`´]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

const ROMAN: Record<string, string> = {
  ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16',
};

/** Words used for matching: roman numerals become digits ("GTA VI" = "GTA 6"), "and" is dropped. */
export function tokens(s: string): string[] {
  return words(s).filter((w) => w !== 'and').map((w) => ROMAN[w] ?? w);
}

export function slugify(s: string): string {
  return words(s).join('-');
}

export const usableMatch = (m: MatchQuality): boolean => m === 'exact' || m === 'close';

/** GoClecD (French AllKeyShop) page for a catalog entry, built from its name. */
export function comparatorUrl(matchedName: string, platform: Platform): string {
  const w = words(matchedName);
  if (platform !== 'pc' && w[w.length - 1] === platform) w.pop();
  const slug = w.join('-');
  return platform === 'pc'
    ? `https://www.goclecd.fr/acheter-${slug}-cle-cd-comparateur-prix/`
    : `https://www.goclecd.fr/acheter-${slug}-${platform}-comparateur-prix/`;
}

const eurFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const eur = (n: number): string => eurFormat.format(n);
