import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { SESSION_DAYS, validateSession } from '@/lib/auth/accounts.ts';
import { config } from '@/lib/config.ts';
import { getDb } from '@/lib/db/index.ts';
import type { User } from '@/lib/db/schema.ts';

export const SESSION_COOKIE = 'wl_session';

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: config.secureCookies,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_DAYS * 86_400,
});

/** The signed-in user for this request (one database read per request). */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await validateSession(getDb(), token);
  return result?.user ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Only from a Server Action or a Route Handler. */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Client address for rate limiting. Only trusts proxy headers when TRUST_PROXY=true. */
export async function clientIp(): Promise<string> {
  if (!config.trustProxy) return 'direct';
  const h = await headers();
  return h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}
