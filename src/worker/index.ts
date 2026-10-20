/**
 * Background service, started next to the site (docker compose "worker").
 * - every 5 seconds: prices of games just added;
 * - once a day at DAILY_AT (Paris time by default): catalog, every followed
 *   game, alerts.
 */
import { closeDb, getDb } from '../lib/db/index.ts';
import { config } from '../lib/config.ts';
import { catalogIsEmpty, dailyRun, getMeta, pendingRun, syncCatalog, type WorkerContext } from './jobs.ts';

const TIME_ZONE = process.env.TIMEZONE?.trim() || 'Europe/Paris';
const DAILY_AT = /^\d{2}:\d{2}$/.test(process.env.DAILY_AT ?? '') ? (process.env.DAILY_AT as string) : '08:41';
const TICK_MS = 5_000;

const ctx: WorkerContext = {
  db: getDb(),
  currency: 'eur',
  botToken: config.discordBotToken,
  appUrl: config.appUrl,
};

/** "YYYY-MM-DD" and "HH:MM" in the configured time zone. */
function localParts(date: Date): { day: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function dailyDue(now: Date): Promise<boolean> {
  const today = localParts(now);
  if (today.time < DAILY_AT) return false;
  const last = await getMeta(ctx.db, 'lastDailyRun');
  return typeof last !== 'string' || localParts(new Date(last)).day !== today.day;
}

let stopping = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    if (await dailyDue(new Date())) await dailyRun(ctx);
    await pendingRun(ctx);
  } catch (e) {
    console.error('[worker] Erreur :', e);
  }
  if (!stopping) timer = setTimeout(tick, TICK_MS);
}

async function start(): Promise<void> {
  console.log(`[worker] Démarré. Relevé quotidien à ${DAILY_AT} (${TIME_ZONE}).`);
  if (!config.discordBotToken) console.log('[worker] DISCORD_BOT_TOKEN absent : alertes sur le site uniquement.');
  try {
    if (await catalogIsEmpty(ctx.db)) await syncCatalog(ctx);
  } catch (e) {
    console.error('[worker] Catalogue indisponible pour le moment :', e instanceof Error ? e.message : e);
  }
  await tick();
}

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} reçu, arrêt.`);
  if (timer) clearTimeout(timer);
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
void start();
