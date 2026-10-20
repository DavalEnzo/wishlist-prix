import type { Metadata } from 'next';
import { WishlistView } from '@/components/WishlistView.tsx';
import { getDb } from '@/lib/db/index.ts';
import { catalogSize, lastRun, prefsOf, wishlistFor } from '@/lib/wishlist.ts';
import { requireUser } from '@/server/session.ts';

export const metadata: Metadata = { title: 'Ma wishlist' };
export const dynamic = 'force-dynamic';

export default async function WishlistPage() {
  const user = await requireUser();
  const db = getDb();
  const [items, last, size] = await Promise.all([wishlistFor(db, user), lastRun(db), catalogSize(db)]);
  return (
    <main className="wrap">
      <WishlistView
        items={items}
        prefs={prefsOf(user)}
        lastRun={last}
        catalogReady={size > 0}
        discordLinked={Boolean(user.discordId)}
        dmError={user.dmError}
      />
    </main>
  );
}
