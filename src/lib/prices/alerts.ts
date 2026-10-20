import { eur, fromCents } from './text.ts';
import { PLATFORM_LABEL, type Offer } from './types.ts';

/** A new alert for the same game needs a drop of at least this much (cents). */
export const REALERT_MIN_DROP_CENTS = 50;

export type AlertDecision =
  | { kind: 'alert'; priceCents: number }
  | { kind: 'keep' }
  | { kind: 'reset' };

/**
 * Alert when a game first goes under its target, then again only if the price
 * drops further. Going back above the target re-arms the alert.
 */
export function decideAlert(targetCents: number | null, bestCents: number | null, lastAlertCents: number | null): AlertDecision {
  if (targetCents === null || bestCents === null || bestCents > targetCents) {
    return lastAlertCents === null ? { kind: 'keep' } : { kind: 'reset' };
  }
  if (lastAlertCents !== null && bestCents > lastAlertCents - REALERT_MIN_DROP_CENTS) return { kind: 'keep' };
  return { kind: 'alert', priceCents: bestCents };
}

export interface AlertMessage {
  title: string;
  body: string;
}

export function alertMessage(game: string, offer: Offer, targetCents: number, previousCents: number | null): AlertMessage {
  const lines = [
    `${offer.store} · ${PLATFORM_LABEL[offer.platform]} · ${offer.kind === 'officiel' ? 'boutique officielle' : 'revendeur de clés'}`,
    `Édition : ${offer.edition} · Région : ${offer.region}`,
    offer.coupon ? `Code promo : ${offer.coupon}` : null,
    previousCents !== null ? `Nouvelle baisse (avant : ${eur(fromCents(previousCents))})` : `Sous ton prix cible de ${eur(fromCents(targetCents))}`,
  ].filter((l): l is string => l !== null);
  return { title: `${game} : ${eur(offer.price)}`, body: lines.join('\n') };
}

/** A Discord message that can never ping anyone (store names come from the API). */
export function discordMessage(msg: AlertMessage, url: string | null, siteUrl: string | null): object {
  return {
    content: 'Un jeu de ta wishlist passe sous ton prix cible',
    embeds: [
      {
        title: msg.title.slice(0, 256),
        url: url ?? undefined,
        description: (siteUrl ? `${msg.body}\n\n[Voir ma wishlist](${siteUrl}/wishlist)` : msg.body).slice(0, 4000),
        color: 0x16804d,
        footer: { text: 'Wishlist gaming · prix AllKeyShop, vérifie la région avant d’acheter' },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
