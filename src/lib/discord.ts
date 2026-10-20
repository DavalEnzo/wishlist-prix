/**
 * Discord over its REST API, with fetch: sign-in (OAuth2) and alert DMs from
 * the bot. No Discord library.
 */
import type { DiscordProfile } from './auth/accounts.ts';

const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 15_000;

export const DISCORD_CALLBACK_PATH = '/api/auth/discord/callback';
export const OAUTH_COOKIE = 'wl_oauth';

export function discordAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'identify',
    redirect_uri: redirectUri,
    state,
    prompt: 'none',
  }).toString();
  return url.toString();
}

export async function discordProfileFromCode(
  creds: { clientId: string; clientSecret: string },
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordProfile> {
  const tokenRes = await fetchImpl(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) throw new Error(`Discord a refusé la connexion (HTTP ${tokenRes.status})`);
  const token = (await tokenRes.json()) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') throw new Error('Réponse Discord inattendue');

  const meRes = await fetchImpl(`${API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!meRes.ok) throw new Error(`Discord n’a pas renvoyé le profil (HTTP ${meRes.status})`);
  const me = (await meRes.json()) as { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown };
  if (typeof me.id !== 'string' || !/^\d{5,25}$/.test(me.id) || typeof me.username !== 'string') throw new Error('Profil Discord inattendu');
  const name = (typeof me.global_name === 'string' && me.global_name.trim()) || me.username;
  const avatar = typeof me.avatar === 'string' && /^(a_)?[0-9a-f]{32}$/.test(me.avatar) ? me.avatar : null;
  return { id: me.id, name: name.slice(0, 40), avatar };
}

export function discordAvatarUrl(discordId: string | null, avatar: string | null): string | null {
  return discordId && avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png?size=64` : null;
}

export type DmResult = { ok: true } | { ok: false; reason: string; permanent: boolean };

/**
 * Sends a direct message from the bot. Discord only allows it when the user
 * shares a server with the bot and accepts DMs from that server's members.
 */
export async function sendDiscordDm(botToken: string, userId: string, message: object, fetchImpl: typeof fetch = fetch): Promise<DmResult> {
  const call = async (path: string, body: object): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${API}${path}`, {
        method: 'POST',
        headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 429 || attempt > 0) return res;
      const wait = Number(((await res.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 2);
      await new Promise((r) => setTimeout(r, Math.min(10, wait) * 1000));
    }
  };
  try {
    const channelRes = await call('/users/@me/channels', { recipient_id: userId });
    if (!channelRes.ok) return failure(channelRes);
    const channel = (await channelRes.json()) as { id?: unknown };
    if (typeof channel.id !== 'string') return { ok: false, reason: 'Réponse Discord inattendue', permanent: false };
    const msgRes = await call(`/channels/${channel.id}/messages`, message);
    return msgRes.ok ? { ok: true } : failure(msgRes);
  } catch (e) {
    return { ok: false, reason: `Discord injoignable (${e instanceof Error ? e.message : String(e)})`, permanent: false };
  }
}

async function failure(res: Response): Promise<DmResult> {
  const body = (await res.json().catch(() => ({}))) as { code?: number };
  if (body.code === 50007) {
    return { ok: false, reason: 'Le bot ne peut pas t’écrire : rejoins le serveur Discord du site et autorise les messages privés de ses membres.', permanent: true };
  }
  if (res.status === 401) return { ok: false, reason: 'Le jeton du bot Discord est invalide (à corriger par l’administrateur).', permanent: false };
  return { ok: false, reason: `Discord a refusé le message (HTTP ${res.status})`, permanent: false };
}
