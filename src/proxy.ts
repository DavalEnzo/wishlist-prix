import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'wl_session';
const MAX_AGE = 30 * 86_400;

/**
 * Keeps the session cookie alive while the user keeps visiting: pages cannot
 * set cookies, so the cookie's lifetime is refreshed here. Whether the
 * session is still valid is checked against the database on every page.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:' || (process.env.APP_URL ?? '').startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE,
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/|fonts/|favicon|api/).*)'],
};
