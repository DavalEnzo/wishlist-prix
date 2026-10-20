import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getDb } from '@/lib/db/index.ts';
import { discordAvatarUrl } from '@/lib/discord.ts';
import { unreadCount } from '@/lib/wishlist.ts';
import { getCurrentUser } from '@/server/session.ts';
import { logoutAction } from './actions/auth.ts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Wishlist Gaming', template: '%s · Wishlist Gaming' },
  description: 'Ta wishlist de jeux avec le prix le plus bas sur PC, PS5 et chez les revendeurs de clés.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8F9FD' },
    { media: '(prefers-color-scheme: dark)', color: '#161931' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const unread = user ? await unreadCount(getDb(), user.id) : 0;
  const avatar = user ? discordAvatarUrl(user.discordId, user.discordAvatar) : null;

  return (
    <html lang="fr">
      <body>
        <header className="topbar">
          <div className="wrap">
            <Link href={user ? '/wishlist' : '/login'} className="brand">
              <span className="brand-mark" aria-hidden="true">WG</span>
              Wishlist gaming
            </Link>
            {user ? (
              <nav className="nav" aria-label="Navigation">
                <Link href="/wishlist">Ma wishlist</Link>
                <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} non lue(s)` : 'Notifications'}>
                  <span className="wide-only">Notifications</span>
                  <span className="narrow-only" aria-hidden="true">Alertes</span>
                  {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
                </Link>
                <Link href="/settings">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="avatar" src={avatar} alt="" width={28} height={28} />
                  ) : (
                    <span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="wide-only">{user.name}</span>
                </Link>
                <form action={logoutAction} className="wide-only">
                  <button type="submit" className="linklike">Déconnexion</button>
                </form>
              </nav>
            ) : (
              <nav className="nav" aria-label="Navigation">
                <Link href="/login">Connexion</Link>
                <Link href="/register">Créer un compte</Link>
              </nav>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
