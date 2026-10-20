'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ItemView } from '@/lib/wishlist.ts';
import { PLATFORM_LABEL, type Offer, type OfferPrefs, type Platform, type PlatformOffers } from '@/lib/prices/types.ts';
import { GameDialog } from './GameDialog.tsx';

type Scope = 'all' | Platform;
type Sort = 'deal' | 'price' | 'priority' | 'recent' | 'title';

const eurf = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eur = (n: number) => eurf.format(n);
const cents = (c: number) => eur(c / 100);
const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayOf = (s: string) => {
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STALE_MS = 2 * 86_400_000;
const PRIO: Record<number, string> = { 1: 'faible', 2: 'moyenne', 3: 'forte' };

function hue(t: string) {
  let h = 0;
  for (const c of t.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
function initials(t: string) {
  const w = t.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return w.length === 1 ? (w[0] as string).slice(0, 2).toUpperCase() : `${(w[0] as string)[0]}${(w[1] as string)[0]}`.toUpperCase();
}

function PlatTag({ p }: { p: Platform }) {
  return (
    <span className="plat"><i className={`dot dot-${p}`} />{PLATFORM_LABEL[p]}</span>
  );
}

function Prio({ n }: { n: number }) {
  return (
    <span className="prio" role="img" aria-label={`Envie ${PRIO[n]}`}>
      {[1, 2, 3].map((i) => <i key={i} className={n >= i ? 'on' : ''} />)}
    </span>
  );
}

function readPrefs(): { scope: Scope; sort: Sort; keys: boolean } {
  const fallback = { scope: 'all' as Scope, sort: 'deal' as Sort, keys: true };
  try {
    const p = JSON.parse(localStorage.getItem('wl-view') ?? '{}');
    return {
      scope: ['all', 'pc', 'ps5'].includes(p.scope) ? p.scope : fallback.scope,
      sort: ['deal', 'price', 'priority', 'recent', 'title'].includes(p.sort) ? p.sort : fallback.sort,
      keys: p.keys !== false,
    };
  } catch {
    return fallback;
  }
}

export interface WishlistViewProps {
  items: ItemView[];
  prefs: OfferPrefs;
  lastRun: string | null;
  catalogReady: boolean;
  discordLinked: boolean;
  dmError: string | null;
}

export function WishlistView({ items, prefs, lastRun, catalogReady, discordLinked, dmError }: WishlistViewProps) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('all');
  const [sort, setSort] = useState<Sort>('deal');
  const [keys, setKeys] = useState(true);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ item: ItemView | null } | null>(null);

  useEffect(() => {
    const p = readPrefs();
    setScope(p.scope);
    setSort(p.sort);
    setKeys(p.keys);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('wl-view', JSON.stringify({ scope, sort, keys }));
    } catch {
      /* storage unavailable */
    }
  }, [scope, sort, keys]);

  // While some prices are still being fetched, refresh every 3 s (for 5 minutes at most).
  const pending = items.some((i) => i.platforms.some((p) => p.pending));
  useEffect(() => {
    if (!pending) return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 100) clearInterval(t);
      router.refresh();
    }, 3_000);
    return () => clearInterval(t);
  }, [pending, router]);

  const inScope = (p: Platform) => scope === 'all' || p === scope;
  const keep = (o: Offer) => keys || o.kind !== 'revendeur';
  const offersOf = (i: ItemView) => i.platforms.filter((p) => inScope(p.platform)).flatMap((p) => p.offers.filter(keep)).sort((a, b) => a.price - b.price);
  const bestOf = (i: ItemView) => offersOf(i)[0] ?? null;
  const target = (i: ItemView) => (i.targetCents === null ? null : i.targetCents / 100);
  const under = (i: ItemView) => {
    const b = bestOf(i);
    const t = target(i);
    return Boolean(b && t !== null && b.price <= t);
  };

  const sorted = useMemo(() => {
    const byTitle = (a: ItemView, b: ItemView) => a.title.localeCompare(b.title, 'fr');
    const price = (i: ItemView) => bestOf(i)?.price ?? 1e9;
    const rank = (i: ItemView) => {
      const b = bestOf(i);
      const t = target(i);
      if (!b) return 3;
      if (t === null) return 2;
      return b.price <= t ? 0 : 1;
    };
    const deal = (a: ItemView, b: ItemView) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return price(a) / (target(a) as number) - price(b) / (target(b) as number) || byTitle(a, b);
      if (ra === 1) return price(a) - (target(a) as number) - (price(b) - (target(b) as number)) || byTitle(a, b);
      return b.priority - a.priority || price(a) - price(b) || byTitle(a, b);
    };
    const cmp: Record<Sort, (a: ItemView, b: ItemView) => number> = {
      deal,
      price: (a, b) => price(a) - price(b) || byTitle(a, b),
      priority: (a, b) => b.priority - a.priority || deal(a, b),
      recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: byTitle,
    };
    const needle = fold(q.trim());
    return items.filter((i) => !needle || fold(i.title).includes(needle)).sort(cmp[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort, q, scope, keys]);

  const hits = items.filter(under);
  const priced = items.map(bestOf).filter((o): o is Offer => o !== null);
  const errors = items.filter((i) => i.platforms.some((p) => p.error)).length;
  const counts: Record<Scope, number> = {
    all: items.filter((i) => i.platforms.some((p) => p.offers.some(keep))).length,
    pc: items.filter((i) => i.platforms.some((p) => p.platform === 'pc' && p.offers.some(keep))).length,
    ps5: items.filter((i) => i.platforms.some((p) => p.platform === 'ps5' && p.offers.some(keep))).length,
  };
  const close = items
    .map((i) => ({ i, b: bestOf(i), t: target(i) }))
    .filter((x): x is { i: ItemView; b: Offer; t: number } => x.b !== null && x.t !== null)
    .sort((x, y) => x.b.price - x.t - (y.b.price - y.t))[0];

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Ma wishlist</h1>
          <p className="sub">PC · PS5 · ROG Ally{lastRun ? ` · relevé du ${when(lastRun)}` : ''}</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setDialog({ item: null })}>Ajouter un jeu</button>
      </div>

      {!catalogReady && (
        <div className="banner">Le catalogue des jeux est en cours de chargement (première mise en route). La recherche sera disponible dans quelques minutes.</div>
      )}
      {errors > 0 && (
        <div className="banner err">
          {errors > 1 ? `${errors} jeux n’ont pas pu être relevés` : 'Un jeu n’a pas pu être relevé'} au dernier passage. Leurs derniers prix connus restent affichés.
        </div>
      )}
      {discordLinked && dmError && (
        <div className="banner err">
          <span>Tes alertes Discord ne passent pas : {dmError}</span>
          <a className="btn sm" href="/settings">Réglages</a>
        </div>
      )}

      <div className="comparebar">
        <nav className="seg" aria-label="Comparer les prix sur">
          {([['all', 'Toutes'], ['pc', 'PC · ROG Ally'], ['ps5', 'PS5']] as [Scope, string][]).map(([id, label]) => (
            <button key={id} type="button" className="segbtn" aria-pressed={scope === id} onClick={() => setScope(id)}>
              {id !== 'all' && <i className={`dot dot-${id}`} />}
              <span>{label}</span>
              <b>{counts[id]}</b>
            </button>
          ))}
        </nav>
        <label className="keytoggle">
          <input type="checkbox" checked={keys} onChange={(e) => setKeys(e.target.checked)} /> Inclure les revendeurs de clés
        </label>
      </div>

      <section className="overview">
        <article className="panel" aria-live="polite">
          {hits.length > 0 ? (
            <>
              <p className="eyebrow"><i className="live" />À acheter maintenant</p>
              <ul className="dealist">
                {hits.slice(0, 4).map((i) => {
                  const b = bestOf(i) as Offer;
                  const url = i.platforms.find((p) => p.platform === b.platform)?.url;
                  return (
                    <li key={i.id} className="dealrow">
                      <div className="dealmain">
                        <b>{i.title}</b>
                        <span className="dealsub"><PlatTag p={b.platform} />{b.store}{b.kind === 'revendeur' ? ' · clé' : ''}{b.coupon ? ` · code ${b.coupon}` : ''}</span>
                      </div>
                      <span className="dealprice">{eur(b.price)}</span>
                      {url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Voir les offres de ${i.title}`}>Voir</a> : <span />}
                    </li>
                  );
                })}
              </ul>
              {hits.length > 4 && <p className="foot">+ {hits.length - 4} autres sous leur prix cible</p>}
            </>
          ) : (
            <>
              <p className="eyebrow">À acheter maintenant</p>
              <h2 className="headline">Rien sous ton prix cible</h2>
              <p className="lead">
                {items.length === 0
                  ? 'Ajoute un premier jeu pour suivre son prix.'
                  : close
                    ? `Le plus proche : ${close.i.title} à ${eur(close.b.price)} (cible ${eur(close.t)}).`
                    : priced.length
                      ? 'Fixe un prix cible sur tes jeux pour les voir remonter ici.'
                      : 'Les prix arrivent au premier relevé.'}
              </p>
            </>
          )}
        </article>
        <aside className="panel">
          <p className="eyebrow">En chiffres{scope === 'all' ? '' : ` · ${PLATFORM_LABEL[scope]}`}</p>
          <dl className="stats">
            <div className="stat"><dt>Jeux suivis</dt><dd>{items.length}</dd></div>
            <div className="stat"><dt>Sous le prix cible</dt><dd>{hits.length}</dd></div>
            <div className="stat">
              <dt>Au meilleur prix</dt>
              <dd>{eur(priced.reduce((a, o) => a + o.price, 0))}</dd>
              <small>{items.length - priced.length ? `${items.length - priced.length} sans prix` : 'pour tout acheter'}</small>
            </div>
            <div className="stat">
              <dt>Alertes</dt>
              <dd className="smallval">{discordLinked ? 'Site + Discord' : 'Sur le site'}</dd>
              <small>{prefs.keyshopAlerts ? 'clés de revendeurs incluses' : 'boutiques officielles seulement'}</small>
            </div>
          </dl>
        </aside>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <div className="toolbar">
          <div className="search">
            <label className="sr" htmlFor="q">Rechercher dans ma wishlist</label>
            <input id="q" className="input" type="search" placeholder="Rechercher dans ma wishlist" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="sortsel">
            <label className="sr" htmlFor="sort">Trier par</label>
            <select id="sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="deal">Tri : meilleure affaire</option>
              <option value="price">Tri : prix le plus bas</option>
              <option value="priority">Tri : niveau d’envie</option>
              <option value="recent">Tri : ajout récent</option>
              <option value="title">Tri : titre A–Z</option>
            </select>
          </div>
        </div>

        {sorted.length > 0 ? (
          <ul className="list">
            {sorted.map((i) => (
              <Row key={i.id} item={i} open={open.has(i.id)} onToggle={() => toggle(i.id)} onEdit={() => setDialog({ item: i })} offers={offersOf(i)} keep={keep} inScope={inScope} under={under(i)} />
            ))}
          </ul>
        ) : (
          <div className="empty">
            {items.length === 0 ? (
              <>
                <h2>Ta wishlist est vide</h2>
                <p>Cherche un jeu dans le catalogue, choisis PC et/ou PS5, et fixe ton prix cible. Tu seras prévenu dès qu’une offre passe dessous.</p>
                <button type="button" className="btn primary" onClick={() => setDialog({ item: null })}>Ajouter mon premier jeu</button>
              </>
            ) : (
              <>
                <h2>Aucun jeu ne correspond</h2>
                <p>Aucun titre ne contient « {q.trim()} ».</p>
              </>
            )}
          </div>
        )}
      </section>

      <p className="pagefoot">Prix relevés chaque matin sur AllKeyShop (GoClecD). Le prix affiché inclut le code promo indiqué. Les clés de revendeurs peuvent être limitées à une région ou à une plateforme d’activation : vérifie l’offre avant d’acheter.</p>

      {dialog && <GameDialog item={dialog.item} catalogReady={catalogReady} onClose={() => setDialog(null)} />}
    </>
  );
}

function Row(props: {
  item: ItemView;
  open: boolean;
  offers: Offer[];
  under: boolean;
  keep: (o: Offer) => boolean;
  inScope: (p: Platform) => boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { item: i, open, offers, under } = props;
  const best = offers[0] ?? null;
  const t = i.targetCents;
  const pending = i.platforms.some((p) => p.pending);
  const error = i.platforms.some((p) => p.error);
  const checked = i.platforms.map((p) => p.checkedAt).filter((x): x is string => x !== null).sort()[0];
  const stale = checked ? Date.now() - new Date(checked).getTime() > STALE_MS : false;
  const official = best ? offers.find((o) => o.kind === 'officiel' && o.platform === best.platform) : undefined;

  return (
    <li className={`row${open ? ' open' : ''}${under ? ' hit' : ''}`}>
      <div className="tile" aria-hidden="true" style={{ ['--h' as string]: hue(i.title) }}>{initials(i.title)}</div>
      <div className="main">
        <h3 className="rowtitle" title={i.title}>{i.title}</h3>
        <div className="meta">
          <Prio n={i.priority} />
          {i.platforms.map((p) => <PlatTag key={p.platform} p={p.platform} />)}
          {pending && <span className="flag info">Relevé en cours…</span>}
          {error && <span className="flag err">Relevé en échec</span>}
          {stale && !pending && <span className="flag warn">Prix du {new Date(checked as string).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>}
        </div>
      </div>
      <div className="price">
        {best ? (
          <>
            <div className="bestprice">
              <b>{eur(best.price)}</b>
              <span className="bestwhere">{best.store} · {PLATFORM_LABEL[best.platform]}{best.kind === 'revendeur' ? ' · clé' : ''}</span>
            </div>
            {official && best.price < official.price * 0.98 && (
              <small>−{Math.round((1 - best.price / official.price) * 100)} % vs {official.store} ({eur(official.price)})</small>
            )}
            {t !== null &&
              (best.price <= t / 100 ? (
                <span className="badge">Sous ton prix cible ({cents(t)})</span>
              ) : (
                <small>Cible {cents(t)} · encore {eur(best.price - t / 100)} de trop</small>
              ))}
          </>
        ) : (
          <small>{pending ? 'Prix en cours de relevé' : i.platforms.some((p) => p.offers.length) ? 'Aucune offre avec ces réglages' : 'Aucune offre récente'}</small>
        )}
      </div>
      <div className="act">
        <button type="button" className="btn sm" aria-expanded={open} onClick={props.onToggle} aria-label={`${open ? 'Masquer' : 'Voir'} le détail de ${i.title}`}>
          {open ? 'Masquer' : offers.length ? `Offres ${offers.length}` : 'Détail'}
        </button>
      </div>
      {open && (
        <div className="detail">
          {i.platforms.filter((p) => props.inScope(p.platform)).map((p) => <PlatformBlock key={p.platform} p={p} keep={props.keep} />)}
          {i.notes && <p className="note">{i.notes}</p>}
          <div className="itemactions">
            <button type="button" className="btn sm" onClick={props.onEdit}>Modifier</button>
          </div>
        </div>
      )}
    </li>
  );
}

function PlatformBlock({ p, keep }: { p: PlatformOffers; keep: (o: Offer) => boolean }) {
  const offers = p.offers.filter(keep);
  const foot: string[] = [];
  if (p.excludedByRegion) foot.push(`${p.excludedByRegion} offre${p.excludedByRegion > 1 ? 's ignorées' : ' ignorée'} (région ou pays)`);
  const h = p.historicalLow;
  if (h?.official) foot.push(`Plus bas historique officiel : ${eur(h.official.price)} chez ${h.official.merchant}${dayOf(h.official.lastUpdate) ? ` (${dayOf(h.official.lastUpdate)})` : ''}`);
  if (h?.keyshops && keep({ kind: 'revendeur' } as Offer)) foot.push(`Plus bas historique revendeurs : ${eur(h.keyshops.price)} chez ${h.keyshops.merchant}`);
  return (
    <div className="pblock">
      <p className="phead">
        <PlatTag p={p.platform} />
        <span className="found">{p.productName}</span>
        <a href={p.url} target="_blank" rel="noopener noreferrer">Voir sur GoClecD</a>
      </p>
      {p.error && <p className="note err">Dernier relevé impossible : {p.error}</p>}
      {p.pending && <p className="note">Prix en cours de relevé, ils s’afficheront dans quelques secondes.</p>}
      {p.editionFallback && <p className="note">Pas d’édition standard trouvée : toutes les éditions sont affichées.</p>}
      {!p.pending && offers.length === 0 && (
        <p className="note">{p.offers.length ? 'Seuls des revendeurs de clés ont ce jeu. Coche « Inclure les revendeurs de clés » pour les voir.' : 'Aucune offre récente.'}</p>
      )}
      {offers.length > 0 && (
        <ul className="offerlist">
          {offers.map((o, n) => (
            <li key={`${o.store}|${o.edition}|${o.region}`} className={`offer${n === 0 ? ' best' : ''}`}>
              <div className="ostore">
                <span>{o.store}</span>
                <div className="ometa">
                  <em className="kind">{o.kind === 'revendeur' ? 'clé revendeur' : 'officiel'}</em>
                  <span>{o.edition}</span>
                  <span>{o.region}</span>
                  {o.coupon && <span className="coupon">code {o.coupon}</span>}
                </div>
              </div>
              <div className="oprice">
                {eur(o.price)}
                {o.listPrice && <s>{eur(o.listPrice)}</s>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {foot.length > 0 && <p className="foot">{foot.join(' · ')}</p>}
    </div>
  );
}
