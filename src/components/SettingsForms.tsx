'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/actions/auth.ts';
import { deleteAccountAction, passwordAction, prefsAction, profileAction, unlinkDiscordAction } from '@/app/actions/settings.ts';

const empty: FormState = {};

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p className="formerr" role="alert">{state.error}</p>;
  if (state.ok) return <p className="formok" role="status">{state.ok}</p>;
  return null;
}

export interface SettingsUser {
  name: string;
  email: string | null;
  hasPassword: boolean;
  discordName: string | null;
  discordLinked: boolean;
  discordAvatar: string | null;
  dmAlerts: boolean;
  dmError: string | null;
  country: string;
  excludeRegions: string[];
  edition: string;
  keyshopAlerts: boolean;
}

export function SettingsForms({ user, discordEnabled, botEnabled, discordInviteUrl }: { user: SettingsUser; discordEnabled: boolean; botEnabled: boolean; discordInviteUrl: string | null }) {
  const [profile, profileFormAction, profilePending] = useActionState(profileAction, empty);
  const [prefs, prefsFormAction, prefsPending] = useActionState(prefsAction, empty);
  const [password, passwordFormAction, passwordPending] = useActionState(passwordAction, empty);
  const [unlink, unlinkFormAction, unlinkPending] = useActionState(unlinkDiscordAction, empty);
  const [del, deleteFormAction, deletePending] = useActionState(deleteAccountAction, empty);

  return (
    <div className="settings">
      <section className="panel">
        <h2>Profil</h2>
        <p className="muted">{user.email ? `Connecté avec ${user.email}` : 'Compte créé avec Discord'}.</p>
        <form action={profileFormAction}>
          <Feedback state={profile} />
          <div className="field">
            <label htmlFor="name">Pseudo</label>
            <input id="name" name="name" defaultValue={user.name} maxLength={40} required />
          </div>
          <button type="submit" className="btn" disabled={profilePending}>Enregistrer</button>
        </form>
      </section>

      <section className="panel">
        <h2>Discord</h2>
        <p className="muted">Relié à Discord, tu te connectes en un clic et tu reçois tes alertes en message privé.</p>
        {user.discordLinked ? (
          <>
            <div className="linked">
              {user.discordAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="avatar" src={user.discordAvatar} alt="" width={28} height={28} />
              ) : (
                <span className="avatar" aria-hidden="true">D</span>
              )}
              <b>{user.discordName ?? 'Compte Discord'}</b>
            </div>
            {user.dmError && (
              <p className="formerr">
                Dernier message privé impossible : {user.dmError}
                {discordInviteUrl && <> <a href={discordInviteUrl} target="_blank" rel="noopener noreferrer">Rejoindre le serveur</a></>}
              </p>
            )}
            {!botEnabled && <p className="note">Les messages privés ne sont pas encore activés sur ce site : tes alertes restent visibles dans Notifications.</p>}
            {botEnabled && discordInviteUrl && !user.dmError && (
              <p className="note">Pour recevoir les messages privés, tu dois être membre du <a href={discordInviteUrl} target="_blank" rel="noopener noreferrer">serveur Discord du site</a>.</p>
            )}
            <form action={unlinkFormAction}>
              <Feedback state={unlink} />
              <button type="submit" className="btn" disabled={unlinkPending}>Détacher Discord</button>
            </form>
          </>
        ) : discordEnabled ? (
          <a className="btn discord" href="/api/auth/discord?mode=link">Relier mon compte Discord</a>
        ) : (
          <p className="note">La connexion avec Discord n’est pas configurée sur ce site.</p>
        )}
      </section>

      <section className="panel">
        <h2>Alertes et règles de prix</h2>
        <p className="muted">Ces règles décident quelles offres comptent, pour l’affichage comme pour les alertes.</p>
        <form action={prefsFormAction}>
          <Feedback state={prefs} />
          <label className="check">
            <input type="checkbox" name="dmAlerts" defaultChecked={user.dmAlerts} disabled={!user.discordLinked} />
            <span>Recevoir les alertes en message privé Discord{!user.discordLinked && ' (relie d’abord ton compte Discord)'}</span>
          </label>
          <label className="check">
            <input type="checkbox" name="keyshopAlerts" defaultChecked={user.keyshopAlerts} />
            <span>Alerter aussi pour les clés de revendeurs (G2A, Eneba, Kinguin…). Décoché : boutiques officielles seulement.</span>
          </label>
          <div className="row2">
            <div className="field">
              <label htmlFor="country">Pays de tes comptes</label>
              <input id="country" name="country" defaultValue={user.country} maxLength={2} required />
              <span className="hint">Code à deux lettres. Les offres liées à un autre pays (PS Store DE, carte PSN espagnole…) sont ignorées.</span>
            </div>
            <div className="field">
              <label htmlFor="edition">Édition par défaut</label>
              <input id="edition" name="edition" defaultValue={user.edition} maxLength={40} />
              <span className="hint">« standard », « all » pour toutes, ou un mot comme « deluxe ».</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="excludeRegions">Régions exclues</label>
            <textarea id="excludeRegions" name="excludeRegions" defaultValue={user.excludeRegions.join(', ')} />
            <span className="hint">Séparées par des virgules. Une offre est ignorée si sa région ou sa boutique contient un de ces mots. Ajoute « Xbox » pour écarter les clés Microsoft Store.</span>
          </div>
          <button type="submit" className="btn primary" disabled={prefsPending}>Enregistrer</button>
        </form>
      </section>

      <section className="panel">
        <h2>{user.hasPassword ? 'Mot de passe' : 'Email et mot de passe'}</h2>
        <p className="muted">{user.hasPassword ? 'Changer ton mot de passe déconnecte tes autres appareils.' : 'Ajoute un email et un mot de passe pour pouvoir te connecter sans Discord.'}</p>
        <form action={passwordFormAction}>
          <Feedback state={password} />
          {user.hasPassword ? (
            <div className="field">
              <label htmlFor="current">Mot de passe actuel</label>
              <input id="current" name="current" type="password" autoComplete="current-password" required />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
          )}
          <div className="row2">
            <div className="field">
              <label htmlFor="password">Nouveau mot de passe</label>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirmation</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
            </div>
          </div>
          <button type="submit" className="btn" disabled={passwordPending}>Enregistrer</button>
        </form>
      </section>

      <section className="panel">
        <h2>Supprimer mon compte</h2>
        <p className="muted">Ta wishlist, tes notifications et ton compte sont effacés définitivement.</p>
        <form action={deleteFormAction}>
          <Feedback state={del} />
          <div className="field">
            <label htmlFor="delete-confirm">Écris SUPPRIMER pour confirmer</label>
            <input id="delete-confirm" name="confirm" autoComplete="off" required />
          </div>
          <button type="submit" className="btn danger" disabled={deletePending}>Supprimer définitivement</button>
        </form>
      </section>
    </div>
  );
}
