'use client';

import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { deleteItemAction, saveItemAction } from '@/app/actions/wishlist.ts';
import type { FormState } from '@/app/actions/auth.ts';
import type { Suggestion } from '@/lib/prices/catalog.ts';
import type { ItemView } from '@/lib/wishlist.ts';

interface Picked {
  title: string;
  pc: number | null;
  ps5: number | null;
}

const empty: FormState = {};

function useSuggestions(query: string, enabled: boolean) {
  const [state, setState] = useState<{ list: Suggestion[]; loading: boolean; error: string | null }>({ list: [], loading: false, error: null });
  useEffect(() => {
    if (!enabled || query.trim().length < 2) {
      setState({ list: [], loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const body = (await res.json()) as { suggestions?: Suggestion[]; error?: string };
        setState({ list: body.suggestions ?? [], loading: false, error: res.ok ? null : body.error ?? 'Recherche impossible.' });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setState({ list: [], loading: false, error: 'Recherche impossible.' });
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, enabled]);
  return state;
}

export function GameDialog({ item, catalogReady, onClose }: { item: ItemView | null; catalogReady: boolean; onClose: () => void }) {
  const editing = item !== null;
  const [picked, setPicked] = useState<Picked | null>(item ? { title: item.title, pc: item.pcProductId, ps5: item.ps5ProductId } : null);
  const [usePc, setUsePc] = useState(item ? item.pcProductId !== null : true);
  const [usePs5, setUsePs5] = useState(item ? item.ps5ProductId !== null : true);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [state, action, saving] = useActionState(saveItemAction, empty);
  const { list, loading, error } = useSuggestions(query, !picked);
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  // When editing, find the other platform of the same game so it can be switched on.
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    fetch(`/api/catalog?q=${encodeURIComponent(item.title)}`)
      .then((r) => r.json())
      .then((body: { suggestions?: Suggestion[] }) => {
        const match = body.suggestions?.find((s) => (item.pcProductId !== null && s.pc?.id === item.pcProductId) || (item.ps5ProductId !== null && s.ps5?.id === item.ps5ProductId));
        if (match && !cancelled) setPicked({ title: item.title, pc: match.pc?.id ?? item.pcProductId, ps5: match.ps5?.id ?? item.ps5ProductId });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!picked) searchRef.current?.focus();
  }, [picked]);

  const choose = (s: Suggestion) => {
    setPicked({ title: s.title, pc: s.pc?.id ?? null, ps5: s.ps5?.id ?? null });
    setUsePc(s.pc !== null);
    setUsePs5(s.ps5 !== null);
    setQuery('');
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && list[active]) {
      e.preventDefault();
      choose(list[active]);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" action={action} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{editing ? 'Modifier le jeu' : 'Ajouter un jeu'}</h2>
        {state.error && <p className="formerr" role="alert">{state.error}</p>}
        {item && <input type="hidden" name="id" value={item.id} />}

        <div className="field">
          <span className="lbl">Jeu</span>
          {picked ? (
            <div className="picked">
              <b>{picked.title}</b>
              {!editing && <button type="button" className="btn sm" onClick={() => setPicked(null)}>Changer</button>}
              <input type="hidden" name="title" value={picked.title} />
              <input type="hidden" name="pcProductId" value={picked.pc ?? ''} />
              <input type="hidden" name="ps5ProductId" value={picked.ps5 ?? ''} />
            </div>
          ) : (
            <div className="combo">
              <label className="sr" htmlFor="game-search">Rechercher un jeu</label>
              <input
                id="game-search"
                ref={searchRef}
                className="input"
                type="search"
                autoComplete="off"
                placeholder={catalogReady ? 'Ex. Hollow Knight Silksong' : 'Catalogue en cours de chargement…'}
                value={query}
                disabled={!catalogReady}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
                role="combobox"
                aria-expanded={list.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
              />
              {query.trim().length >= 2 && (
                <ul className="suggestions" id={listId} role="listbox">
                  {list.map((s, n) => (
                    <li key={`${s.pc?.id ?? ''}-${s.ps5?.id ?? ''}`}>
                      <button type="button" role="option" aria-selected={n === active} onClick={() => choose(s)} onMouseEnter={() => setActive(n)}>
                        <span className="sname">{s.title}</span>
                        <span className="splat">
                          {s.pc && <span><i className="dot dot-pc" /> PC</span>}
                          {s.ps5 && <span><i className="dot dot-ps5" /> PS5</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!loading && list.length === 0 && <li className="note" style={{ padding: 10 }}>{error ?? 'Aucun jeu trouvé. Essaie avec moins de mots.'}</li>}
                  {loading && list.length === 0 && <li className="note" style={{ padding: 10 }}>Recherche…</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="field">
          <span className="lbl" id="plat-label">Comparer les prix sur</span>
          <div className="chips" role="group" aria-labelledby="plat-label">
            <label className="chip">
              <input type="checkbox" name="usePc" checked={usePc && picked?.pc != null} disabled={!picked?.pc} onChange={(e) => setUsePc(e.target.checked)} />
              <span><i className="dot dot-pc" />PC · ROG Ally</span>
            </label>
            <label className="chip">
              <input type="checkbox" name="usePs5" checked={usePs5 && picked?.ps5 != null} disabled={!picked?.ps5} onChange={(e) => setUsePs5(e.target.checked)} />
              <span><i className="dot dot-ps5" />PS5</span>
            </label>
          </div>
          {picked && (!picked.pc || !picked.ps5) && <span className="hint">Ce jeu n’existe que sur {picked.pc ? 'PC' : 'PS5'} dans le catalogue.</span>}
        </div>

        <div className="row2">
          <div className="field">
            <label htmlFor="target">Prix cible (€)</label>
            <input id="target" name="target" inputMode="decimal" placeholder="Ex. 19,99" defaultValue={item?.targetCents != null ? (item.targetCents / 100).toFixed(2).replace('.', ',') : ''} />
            <span className="hint">Tu es prévenu quand une offre passe dessous.</span>
          </div>
          <div className="field">
            <span className="lbl" id="prio-label">Niveau d’envie</span>
            <div className="chips" role="radiogroup" aria-labelledby="prio-label">
              {[[3, 'Forte'], [2, 'Moyenne'], [1, 'Faible']].map(([v, label]) => (
                <label className="chip" key={v}>
                  <input type="radio" name="priority" value={v} defaultChecked={(item?.priority ?? 2) === v} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="edition">Édition (facultatif)</label>
          <input id="edition" name="edition" maxLength={40} placeholder="Standard par défaut, ex. deluxe" defaultValue={item?.edition ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="notes">Remarques</label>
          <textarea id="notes" name="notes" maxLength={500} placeholder="DLC à prendre, attendre une promo…" defaultValue={item?.notes ?? ''} />
        </div>

        <div className="sheetactions">
          {item && (
            <button
              type="button"
              className={`btn danger${confirmDelete ? ' armed' : ''}`}
              disabled={deleting}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 4000);
                  return;
                }
                startDelete(async () => {
                  await deleteItemAction(item.id);
                  onClose();
                });
              }}
            >
              {confirmDelete ? 'Confirmer le retrait' : 'Retirer de la wishlist'}
            </button>
          )}
          <div className="right">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn primary" disabled={saving || !picked || (!usePc && !usePs5)}>
              {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
