import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/index.ts';
import { rateLimit } from '@/lib/ratelimit.ts';
import { catalogSize, searchCatalog } from '@/lib/wishlist.ts';
import { getCurrentUser } from '@/server/session.ts';

/** Game suggestions while typing, for signed-in users only. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Connecte-toi pour chercher un jeu.' }, { status: 401 });
  if (!rateLimit(`catalog:${user.id}`, 120, 60_000).ok) return NextResponse.json({ error: 'Trop de recherches, patiente un instant.' }, { status: 429 });
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 120);
  const db = getDb();
  const suggestions = await searchCatalog(db, q);
  const catalogReady = suggestions.length > 0 || (await catalogSize(db)) > 0;
  return NextResponse.json({ suggestions, catalogReady }, { headers: { 'cache-control': 'private, no-store' } });
}
