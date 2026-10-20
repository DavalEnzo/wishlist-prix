import { buildOffers, pickBest } from './offers.ts';
import { comparatorUrl, usableMatch } from './text.ts';
import { PLATFORM_LABEL, type GameResult, type Platform, type PlatformResult, type PriceSource, type Settings, type WishGame } from './types.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function emptyResult(platform: Platform, query: string): PlatformResult {
  return {
    platform,
    query,
    matchedName: null,
    match: 'none',
    alternatives: [],
    url: null,
    offers: [],
    excludedByRegion: 0,
    editionFallback: false,
    historicalLow: null,
    error: null,
  };
}

export async function checkPlatform(
  source: PriceSource,
  game: WishGame,
  platform: Platform,
  settings: Settings,
): Promise<PlatformResult> {
  const query = game.search[platform] ?? game.title;
  const result = emptyResult(platform, query);
  const found = await source.find(query, platform);
  if (!found) return result;
  result.matchedName = found.name;
  result.match = found.match;
  result.alternatives = found.alternatives;
  result.url = comparatorUrl(found.name, platform);
  // A doubtful match (DLC, account, wrong game) is reported but never priced.
  if (!usableMatch(found.match)) return result;

  const data = await source.prices(found.id);
  const built = buildOffers(platform, data, settings.excludeRegions, game.edition ?? settings.edition);
  result.offers = built.offers;
  result.excludedByRegion = built.excludedByRegion;
  result.editionFallback = built.editionFallback;
  result.historicalLow = data.historicalLow;
  return result;
}

const describeErrors = (results: PlatformResult[]): string =>
  results.map((r) => `${PLATFORM_LABEL[r.platform]} : ${r.error}`).join(' · ');

export async function checkGame(
  source: PriceSource,
  game: WishGame,
  settings: Settings,
  previous: GameResult | undefined,
  opts: { now: Date; delayMs: number },
): Promise<GameResult> {
  const results: PlatformResult[] = [];
  for (const platform of game.platforms) {
    if (results.length > 0 && opts.delayMs > 0) await sleep(opts.delayMs);
    try {
      results.push(await checkPlatform(source, game, platform, settings));
    } catch (e) {
      const r = emptyResult(platform, game.search[platform] ?? game.title);
      r.error = e instanceof Error ? e.message : String(e);
      results.push(r);
    }
  }

  const failed = results.filter((r) => r.error);
  const base = {
    id: game.id,
    title: game.title,
    platforms: game.platforms,
    targetPrice: game.targetPrice,
    priority: game.priority,
    notes: game.notes,
  };

  // Every platform failed: keep the last good prices, flagged with the error.
  if (failed.length === results.length && previous && previous.checkedAt) {
    const kept = (o: GameResult['best']) => (o && game.platforms.includes(o.platform) ? o : null);
    return {
      ...base,
      checkedAt: previous.checkedAt,
      error: describeErrors(failed),
      results: previous.results.filter((r) => game.platforms.includes(r.platform)),
      best: kept(previous.best),
      bestOfficial: kept(previous.bestOfficial),
      alert: previous.alert,
    };
  }

  return {
    ...base,
    checkedAt: opts.now.toISOString(),
    error: failed.length > 0 ? describeErrors(failed) : null,
    results,
    best: pickBest(results),
    bestOfficial: pickBest(results, 'officiel'),
    alert: previous?.alert ?? null,
  };
}
