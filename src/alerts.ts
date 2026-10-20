import { eur } from './text.ts';
import { PLATFORM_LABEL, type AlertState, type GameResult, type Offer, type Settings } from './types.ts';

export interface Alert {
  gameId: string;
  title: string;
  targetPrice: number;
  offer: Offer;
  previousAlertPrice: number | null;
  url: string | null;
}

/** A new alert for the same game needs a drop of at least this much. */
export const REALERT_MIN_DROP = 0.5;

/**
 * Alert when a game first goes under its target, then again only if the price
 * drops further. Going back above the target re-arms the alert. A failed
 * check never re-arms it.
 */
export function decideAlerts(
  games: GameResult[],
  settings: Settings,
  now: Date,
  notChecked: ReadonlySet<string> = new Set(),
): { games: GameResult[]; alerts: Alert[] } {
  const alerts: Alert[] = [];
  const updated = games.map((g) => {
    if (notChecked.has(g.id)) return g;
    const offer = settings.keyshopAlerts ? g.best : g.bestOfficial;
    if (!g.targetPrice || !offer || offer.price > g.targetPrice) return { ...g, alert: null };
    const prev = g.alert;
    if (prev && offer.price > prev.price - REALERT_MIN_DROP) return g;
    const state: AlertState = { price: offer.price, at: now.toISOString() };
    const url = g.results.find((r) => r.platform === offer.platform)?.url ?? null;
    alerts.push({ gameId: g.id, title: g.title, targetPrice: g.targetPrice, offer, previousAlertPrice: prev?.price ?? null, url });
    return { ...g, alert: state };
  });
  return { games: updated, alerts };
}

const DISCORD_HOST = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const isDiscordWebhook = (url: string): boolean => DISCORD_HOST.test(url.trim());

export function discordPayloads(alerts: Alert[]): object[] {
  const embeds = alerts.map((a) => {
    const o = a.offer;
    const details = [
      `${o.store} · ${PLATFORM_LABEL[o.platform]} · ${o.kind === 'officiel' ? 'boutique officielle' : 'revendeur de clés'}`,
      `Édition : ${o.edition} · Région : ${o.region}`,
      o.coupon ? `Code promo : ${o.coupon}` : null,
      a.previousAlertPrice !== null ? `Nouvelle baisse (avant : ${eur(a.previousAlertPrice)})` : `Sous ton prix cible de ${eur(a.targetPrice)}`,
    ].filter(Boolean);
    return {
      title: `${a.title} : ${eur(o.price)}`.slice(0, 256),
      url: a.url ?? undefined,
      description: details.join('\n').slice(0, 2000),
      color: 0x16804d,
      footer: { text: 'Wishlist gaming · prix AllKeyShop, vérifie la région avant d’acheter' },
    };
  });
  const payloads: object[] = [];
  for (let i = 0; i < embeds.length; i += 10) {
    payloads.push({
      username: 'Wishlist gaming',
      content: i === 0 ? (alerts.length > 1 ? `${alerts.length} jeux passent sous ton prix cible` : 'Un jeu passe sous ton prix cible') : '',
      embeds: embeds.slice(i, i + 10),
      // Store names come from the API: never let them ping anyone.
      allowed_mentions: { parse: [] },
    });
  }
  return payloads;
}

export async function sendDiscord(
  webhookUrl: string,
  alerts: Alert[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isDiscordWebhook(webhookUrl)) throw new Error('DISCORD_WEBHOOK_URL ne ressemble pas à une URL de webhook Discord');
  for (const payload of discordPayloads(alerts)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) break;
      if (res.status === 429 && attempt === 0) {
        const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
        await new Promise((r) => setTimeout(r, Math.min(10, body.retry_after ?? 2) * 1000));
        continue;
      }
      throw new Error(`Discord a refusé l’alerte (HTTP ${res.status})`);
    }
  }
}
