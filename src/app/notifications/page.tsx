import type { Metadata } from 'next';
import { MarkRead } from '@/components/MarkRead.tsx';
import { getDb } from '@/lib/db/index.ts';
import { listNotifications } from '@/lib/wishlist.ts';
import { requireUser } from '@/server/session.ts';
import { clearNotificationsAction } from '../actions/wishlist.ts';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const when = (d: Date) => d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: process.env.TIMEZONE || 'Europe/Paris' });

export default async function NotificationsPage() {
  const user = await requireUser();
  const notes = await listNotifications(getDb(), user.id);
  const unread = notes.some((n) => !n.readAt);
  return (
    <main className="wrap">
      <div className="pagehead">
        <div>
          <h1>Notifications</h1>
          <p className="sub">Alertes de prix · 50 dernières</p>
        </div>
        {notes.length > 0 && (
          <form action={clearNotificationsAction}>
            <button type="submit" className="btn">Tout effacer</button>
          </form>
        )}
      </div>
      {unread && <MarkRead />}
      {notes.length === 0 ? (
        <div className="empty">
          <h2>Aucune notification</h2>
          <p>Quand un jeu de ta wishlist passe sous son prix cible, l’alerte apparaît ici{user.discordId ? ' et en message privé Discord' : ''}.</p>
        </div>
      ) : (
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id} className={n.readAt ? '' : 'unread'}>
              <span className="ndot" aria-label={n.readAt ? undefined : 'Non lue'} />
              <div>
                <p className="ntitle">{n.title}</p>
                <p className="nbody">{n.body}</p>
                <p className="nmeta">
                  <span>{when(n.createdAt)}</span>
                  {n.url && /^https:\/\//.test(n.url) && <a href={n.url} target="_blank" rel="noopener noreferrer">Voir les offres</a>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
