import { NextResponse, type NextRequest } from 'next/server';
import { randomToken } from '@/lib/auth/crypto.ts';
import { config } from '@/lib/config.ts';
import { DISCORD_CALLBACK_PATH, OAUTH_COOKIE, discordAuthorizeUrl } from '@/lib/discord.ts';
import { getCurrentUser } from '@/server/session.ts';

/**
 * Starts "Continue with Discord". mode=link attaches Discord to the signed-in
 * account; otherwise it signs in (or signs up, with the invite code if one is
 * required). The state cookie protects the callback against forged requests.
 */
export async function GET(request: NextRequest) {
  const discord = config.discord;
  if (!discord) return NextResponse.redirect(new URL('/login?error=discord_off', config.appUrl));
  const params = request.nextUrl.searchParams;
  const mode = params.get('mode') === 'link' ? 'link' : 'login';
  if (mode === 'link' && !(await getCurrentUser())) return NextResponse.redirect(new URL('/login', config.appUrl));

  const state = randomToken();
  const invite = (params.get('invite') ?? '').slice(0, 100);
  const response = NextResponse.redirect(discordAuthorizeUrl(discord.clientId, `${config.appUrl}${DISCORD_CALLBACK_PATH}`, state));
  response.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, mode, invite }), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/api/auth/discord',
    maxAge: 600,
  });
  return response;
}
