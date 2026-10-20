import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, createSession, linkDiscord, signInWithDiscord } from '@/lib/auth/accounts.ts';
import { config } from '@/lib/config.ts';
import { getDb } from '@/lib/db/index.ts';
import { DISCORD_CALLBACK_PATH, OAUTH_COOKIE, discordProfileFromCode } from '@/lib/discord.ts';
import { rateLimit } from '@/lib/ratelimit.ts';
import { clientIp, getCurrentUser, SESSION_COOKIE, sessionCookieOptions } from '@/server/session.ts';

const go = (path: string) => {
  const res = NextResponse.redirect(new URL(path, config.appUrl));
  res.cookies.set(OAUTH_COOKIE, '', { path: '/api/auth/discord', maxAge: 0 });
  return res;
};

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: NextRequest) {
  const discord = config.discord;
  if (!discord) return go('/login?error=discord_off');
  const params = request.nextUrl.searchParams;

  let saved: { state?: unknown; mode?: unknown; invite?: unknown } = {};
  try {
    saved = JSON.parse(request.cookies.get(OAUTH_COOKIE)?.value ?? '{}');
  } catch {
    /* treated as missing below */
  }
  const state = params.get('state') ?? '';
  const back = saved.mode === 'link' ? '/settings' : '/login';
  if (typeof saved.state !== 'string' || !state || !sameText(saved.state, state)) return go(`${back}?error=discord_state`);
  if (params.get('error')) return go(`${back}?error=discord_cancel`);
  const code = params.get('code');
  if (!code) return go(`${back}?error=discord_failed`);
  if (!rateLimit(`discord:${await clientIp()}`, 30, 15 * 60_000).ok) return go(`${back}?error=too_many`);

  let profile;
  try {
    profile = await discordProfileFromCode(discord, code, `${config.appUrl}${DISCORD_CALLBACK_PATH}`);
  } catch (e) {
    console.error('Connexion Discord impossible :', e);
    return go(`${back}?error=discord_failed`);
  }

  const db = getDb();
  if (saved.mode === 'link') {
    const user = await getCurrentUser();
    if (!user) return go('/login');
    try {
      await linkDiscord(db, user.id, profile);
    } catch (e) {
      if (e instanceof AuthError) return go('/settings?error=discord_taken');
      throw e;
    }
    return go('/settings?ok=discord_linked');
  }

  const invite = typeof saved.invite === 'string' ? saved.invite.trim() : '';
  const allowCreate = !config.signupCode || invite === config.signupCode;
  const user = await signInWithDiscord(db, profile, allowCreate);
  if (!user) return go('/login?error=invite_required');
  const { token } = await createSession(db, user.id);
  const res = go('/wishlist');
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
