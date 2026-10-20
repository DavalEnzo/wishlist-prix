'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { forgotAction, loginAction, registerAction, resetAction, type FormState } from '@/app/actions/auth.ts';

const empty: FormState = {};

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p className="formerr" role="alert">{state.error}</p>;
  if (state.ok) return <p className="formok" role="status">{state.ok}</p>;
  return null;
}

function DiscordButton({ label, inviteRequired }: { label: string; inviteRequired: boolean }) {
  // The invite code (when required) travels with the Discord request: a form GET.
  return (
    <form action="/api/auth/discord" method="get">
      {inviteRequired && (
        <div className="field">
          <label htmlFor="discord-invite">Code d’invitation (nouveau compte)</label>
          <input id="discord-invite" name="invite" autoComplete="off" />
        </div>
      )}
      <button type="submit" className="btn discord block">{label}</button>
    </form>
  );
}

export function LoginForm({ discord, inviteRequired }: { discord: boolean; inviteRequired: boolean }) {
  const [state, action, pending] = useActionState(loginAction, empty);
  return (
    <>
      {discord && (
        <>
          <DiscordButton label="Continuer avec Discord" inviteRequired={inviteRequired} />
          <p className="or">ou</p>
        </>
      )}
      <form action={action}>
        <Feedback state={state} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
        </div>
        <div className="field">
          <label htmlFor="password">Mot de passe</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit" className="btn primary block" disabled={pending}>{pending ? 'Connexion…' : 'Se connecter'}</button>
      </form>
      <p className="authlinks">
        <Link href="/forgot">Mot de passe oublié ?</Link>
        <Link href="/register">Créer un compte</Link>
      </p>
    </>
  );
}

export function RegisterForm({ discord, inviteRequired }: { discord: boolean; inviteRequired: boolean }) {
  const [state, action, pending] = useActionState(registerAction, empty);
  return (
    <>
      {discord && (
        <>
          <DiscordButton label="S’inscrire avec Discord" inviteRequired={inviteRequired} />
          <p className="or">ou avec un email</p>
        </>
      )}
      <form action={action}>
        <Feedback state={state} />
        <div className="field">
          <label htmlFor="name">Pseudo</label>
          <input id="name" name="name" autoComplete="nickname" required maxLength={40} defaultValue={state.values?.name} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirmation</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
          </div>
        </div>
        {inviteRequired && (
          <div className="field">
            <label htmlFor="invite">Code d’invitation</label>
            <input id="invite" name="invite" autoComplete="off" required defaultValue={state.values?.invite} />
            <span className="hint">Demande-le à la personne qui gère le site.</span>
          </div>
        )}
        <button type="submit" className="btn primary block" disabled={pending}>{pending ? 'Création…' : 'Créer mon compte'}</button>
      </form>
      <p className="authlinks">
        <span className="muted">Déjà inscrit ?</span>
        <Link href="/login">Se connecter</Link>
      </p>
    </>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotAction, empty);
  return (
    <form action={action}>
      <Feedback state={state} />
      {!state.ok && (
        <>
          <div className="field">
            <label htmlFor="email">Email du compte</label>
            <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
          </div>
          <button type="submit" className="btn primary block" disabled={pending}>{pending ? 'Envoi…' : 'Recevoir un lien'}</button>
        </>
      )}
      <p className="authlinks"><Link href="/login">Retour à la connexion</Link></p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAction, empty);
  return (
    <form action={action}>
      <Feedback state={state} />
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="password">Nouveau mot de passe</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        <span className="hint">Au moins 10 caractères.</span>
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirmation</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </div>
      <button type="submit" className="btn primary block" disabled={pending}>{pending ? 'Enregistrement…' : 'Changer le mot de passe'}</button>
    </form>
  );
}
