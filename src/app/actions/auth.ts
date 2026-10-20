'use server';

import { redirect } from 'next/navigation';
import {
  AuthError,
  createPasswordReset,
  createSession,
  deleteSession,
  loginWithEmail,
  registerWithEmail,
  resetPasswordWithToken,
} from '@/lib/auth/accounts.ts';
import { config } from '@/lib/config.ts';
import { getDb } from '@/lib/db/index.ts';
import { mailEnabled, sendResetEmail } from '@/lib/mail.ts';
import { rateLimit, tooMany } from '@/lib/ratelimit.ts';
import { normalizeEmail, str } from '@/lib/validate.ts';
import { clearSessionCookie, clientIp, currentSessionToken, setSessionCookie } from '@/server/session.ts';

export interface FormState {
  error?: string;
  ok?: string;
  /** Values to put back in the form after an error. */
  values?: Record<string, string>;
}

async function signIn(userId: string): Promise<void> {
  const { token } = await createSession(getDb(), userId);
  await setSessionCookie(token);
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, 'email');
  const ip = await clientIp();
  const byIp = rateLimit(`login:${ip}`, 30, 15 * 60_000);
  const byEmail = rateLimit(`login-email:${normalizeEmail(email)}`, 10, 15 * 60_000);
  if (!byIp.ok || !byEmail.ok) return { error: tooMany(Math.max(byIp.retryInSec, byEmail.retryInSec)), values: { email } };
  try {
    const user = await loginWithEmail(getDb(), email, str(form, 'password'));
    await signIn(user.id);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message, values: { email } };
    throw e;
  }
  redirect('/wishlist');
}

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = { name: str(form, 'name'), email: str(form, 'email'), invite: str(form, 'invite') };
  const limit = rateLimit(`register:${await clientIp()}`, 10, 60 * 60_000);
  if (!limit.ok) return { error: tooMany(limit.retryInSec), values };
  if (config.signupCode && values.invite.trim() !== config.signupCode) {
    return { error: 'Code d’invitation incorrect. Demande-le à la personne qui gère le site.', values };
  }
  if (str(form, 'password') !== str(form, 'confirm')) return { error: 'Les deux mots de passe ne sont pas identiques.', values };
  try {
    const user = await registerWithEmail(getDb(), { name: values.name, email: values.email, password: str(form, 'password') });
    await signIn(user.id);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message, values };
    throw e;
  }
  redirect('/wishlist');
}

export async function logoutAction(): Promise<void> {
  const token = await currentSessionToken();
  if (token) await deleteSession(getDb(), token);
  await clearSessionCookie();
  redirect('/login');
}

export async function forgotAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, 'email');
  if (!mailEnabled()) {
    return { error: 'L’envoi d’emails n’est pas configuré sur ce site. Demande à l’administrateur de te créer un lien de réinitialisation.' };
  }
  const limit = rateLimit(`forgot:${await clientIp()}`, 5, 60 * 60_000);
  if (!limit.ok) return { error: tooMany(limit.retryInSec), values: { email } };
  const done = 'Si un compte existe avec cette adresse, un lien de réinitialisation vient d’y être envoyé. Il est valable une heure.';
  const reset = await createPasswordReset(getDb(), email);
  if (reset?.user.email) {
    try {
      await sendResetEmail(reset.user.email, reset.user.name, `${config.appUrl}/reset/${reset.token}`);
    } catch (e) {
      console.error('Envoi de l’email de réinitialisation impossible :', e);
      return { error: 'L’email n’a pas pu être envoyé. Réessaie plus tard.', values: { email } };
    }
  }
  return { ok: done };
}

export async function resetAction(_prev: FormState, form: FormData): Promise<FormState> {
  const limit = rateLimit(`reset:${await clientIp()}`, 10, 15 * 60_000);
  if (!limit.ok) return { error: tooMany(limit.retryInSec) };
  if (str(form, 'password') !== str(form, 'confirm')) return { error: 'Les deux mots de passe ne sont pas identiques.' };
  try {
    const user = await resetPasswordWithToken(getDb(), str(form, 'token'), str(form, 'password'));
    await signIn(user.id);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
  redirect('/wishlist');
}
