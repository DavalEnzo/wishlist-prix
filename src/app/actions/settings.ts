'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AuthError, deleteAccount, setPassword, unlinkDiscord } from '@/lib/auth/accounts.ts';
import { getDb } from '@/lib/db/index.ts';
import { rateLimit, tooMany } from '@/lib/ratelimit.ts';
import { str } from '@/lib/validate.ts';
import { InputError, updateName, updatePrefs } from '@/lib/wishlist.ts';
import { clearSessionCookie, currentSessionToken, requireUser } from '@/server/session.ts';
import type { FormState } from './auth.ts';

async function guarded(run: () => Promise<string>): Promise<FormState> {
  try {
    const ok = await run();
    revalidatePath('/', 'layout');
    return { ok };
  } catch (e) {
    if (e instanceof InputError || e instanceof AuthError) return { error: e.message };
    throw e;
  }
}

export async function profileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guarded(async () => {
    await updateName(getDb(), user.id, str(form, 'name'));
    return 'Pseudo enregistré.';
  });
}

export async function prefsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guarded(async () => {
    await updatePrefs(getDb(), user.id, {
      country: str(form, 'country'),
      excludeRegions: str(form, 'excludeRegions').split(/[,\n]/),
      edition: str(form, 'edition'),
      keyshopAlerts: form.get('keyshopAlerts') === 'on',
      // The checkbox is disabled (not sent) until Discord is linked: keep the stored choice.
      dmAlerts: user.discordId ? form.get('dmAlerts') === 'on' : user.dmAlerts,
    });
    return 'Préférences enregistrées.';
  });
}

export async function passwordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const limit = rateLimit(`password:${user.id}`, 10, 15 * 60_000);
  if (!limit.ok) return { error: tooMany(limit.retryInSec) };
  if (str(form, 'password') !== str(form, 'confirm')) return { error: 'Les deux mots de passe ne sont pas identiques.' };
  return guarded(async () => {
    await setPassword(getDb(), user, { current: str(form, 'current'), email: str(form, 'email'), password: str(form, 'password') }, await currentSessionToken());
    return user.passwordHash ? 'Mot de passe changé. Tes autres appareils ont été déconnectés.' : 'Email et mot de passe ajoutés : tu peux aussi te connecter avec eux.';
  });
}

export async function unlinkDiscordAction(_prev: FormState): Promise<FormState> {
  const user = await requireUser();
  return guarded(async () => {
    await unlinkDiscord(getDb(), user);
    return 'Compte Discord détaché.';
  });
}

export async function deleteAccountAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (str(form, 'confirm').trim().toUpperCase() !== 'SUPPRIMER') return { error: 'Écris SUPPRIMER pour confirmer.' };
  await deleteAccount(getDb(), user.id);
  await clearSessionCookie();
  redirect('/login');
}
