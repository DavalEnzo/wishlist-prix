import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decideAlerts, sendDiscord, type Alert } from './alerts.ts';
import { createAllKeyShop } from './allkeyshop.ts';
import { checkGame } from './prices.ts';
import { eur, usableMatch } from './text.ts';
import { loadWishlist } from './wishlist.ts';
import { PLATFORM_LABEL, type GameResult, type PriceSource, type PricesFile } from './types.ts';

export interface RunOptions {
  root: string;
  dryRun: boolean;
  webhookUrl?: string;
  delayMs?: number;
  now?: () => Date;
  source?: PriceSource;
  /** HTTP client for Discord (tests). */
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export interface RunResult {
  file: PricesFile;
  alerts: Alert[];
  /** True when Discord accepted the alerts. */
  delivered: boolean;
  /** Why Discord refused the alerts, if it did. */
  alertError: string | null;
  /** True when nothing could be priced because requests failed. */
  failed: boolean;
}

export const PRICES_PATH = join('docs', 'data', 'prices.json');

async function readPrevious(path: string): Promise<Map<string, GameResult>> {
  try {
    const file = JSON.parse(await readFile(path, 'utf8')) as Partial<PricesFile>;
    return new Map((file.games ?? []).map((g) => [g.id, g]));
  } catch {
    return new Map();
  }
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const wishlist = await loadWishlist(join(opts.root, 'wishlist.json'));
  const pricesPath = join(opts.root, PRICES_PATH);
  const previous = await readPrevious(pricesPath);
  const source = opts.source ?? createAllKeyShop({ currency: wishlist.settings.currency });
  const delayMs = opts.delayMs ?? 1500;
  const runAt = (opts.now ?? (() => new Date()))();
  const runIso = runAt.toISOString();

  log(`Relevé de ${wishlist.games.length} jeu(x)…`);
  const checked: GameResult[] = [];
  for (const [i, game] of wishlist.games.entries()) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const result = await checkGame(source, game, wishlist.settings, previous.get(game.id), { now: runAt, delayMs });
    checked.push(result);
    const best = result.best ? `${eur(result.best.price)} chez ${result.best.store} (${PLATFORM_LABEL[result.best.platform]})` : 'aucune offre retenue';
    const doubtful = result.results.filter((r) => r.match === 'doubtful').map((r) => `${PLATFORM_LABEL[r.platform]} → « ${r.matchedName} »`);
    log(`- ${game.title} : ${best}${doubtful.length ? ` · nom à vérifier : ${doubtful.join(', ')}` : ''}${result.error ? ` · erreur : ${result.error}` : ''}`);
  }

  // A game is "not checked" when every platform failed this run.
  const notChecked = new Set(
    checked
      .filter((g) => g.error !== null && (g.checkedAt !== runIso || g.results.every((r) => r.error !== null)))
      .map((g) => g.id),
  );
  const decided = decideAlerts(checked, wishlist.settings, runAt, notChecked);
  let games = decided.games;
  const { alerts } = decided;

  // An alert counts as sent only once Discord accepted it; otherwise it is
  // raised again on the next run.
  let delivered = false;
  let alertError: string | null = null;
  if (alerts.length > 0) {
    const lines = alerts.map((a) => `  ${a.title} : ${eur(a.offer.price)} (cible ${eur(a.targetPrice)})`).join('\n');
    if (opts.dryRun) log(`${alerts.length} alerte(s), non envoyée(s) (essai) :\n${lines}`);
    else if (!opts.webhookUrl) log(`${alerts.length} alerte(s), non envoyée(s) : DISCORD_WEBHOOK_URL n’est pas défini :\n${lines}`);
    else {
      try {
        await sendDiscord(opts.webhookUrl, alerts, opts.fetchImpl);
        delivered = true;
        log(`${alerts.length} alerte(s) envoyée(s) sur Discord.`);
      } catch (e) {
        alertError = e instanceof Error ? e.message : String(e);
        log(`Alerte(s) non envoyée(s) : ${alertError}`);
      }
    }
    if (!delivered) {
      const before = new Map(checked.map((g) => [g.id, g.alert]));
      const alerted = new Set(alerts.map((a) => a.gameId));
      games = games.map((g) => (alerted.has(g.id) ? { ...g, alert: before.get(g.id) ?? null } : g));
    }
  } else {
    log('Aucune nouvelle alerte.');
  }

  const file: PricesFile = {
    version: 1,
    generatedAt: runIso,
    source: 'AllKeyShop (API non publique, client intégré au projet)',
    settings: {
      country: wishlist.settings.country,
      excludeRegions: wishlist.settings.excludeRegions,
      edition: wishlist.settings.edition,
      keyshopAlerts: wishlist.settings.keyshopAlerts,
    },
    games,
  };
  await mkdir(dirname(pricesPath), { recursive: true });
  await writeFile(pricesPath, `${JSON.stringify(file, null, 2)}\n`);
  log(`Prix enregistrés dans ${PRICES_PATH}.`);

  const priced = checked.some((g) => !notChecked.has(g.id) && g.results.some((r) => !r.error && usableMatch(r.match)));
  const errored = checked.some((g) => g.error !== null);
  return { file, alerts, delivered, alertError, failed: !priced && errored };
}
