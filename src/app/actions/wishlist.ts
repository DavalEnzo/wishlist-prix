'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/index.ts';
import { rateLimit, tooMany } from '@/lib/ratelimit.ts';
import { parseEuros, str } from '@/lib/validate.ts';
import { addItem, clearNotifications, deleteItem, InputError, markAllRead, updateItem, type ItemInput } from '@/lib/wishlist.ts';
import { requireUser } from '@/server/session.ts';
import type { FormState } from './auth.ts';

const productId = (form: FormData, key: string, enabled: string): number | null => {
  if (form.get(enabled) !== 'on') return null;
  const v = Number(str(form, key));
  return Number.isSafeInteger(v) && v > 0 ? v : null;
};

export async function saveItemAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const limit = rateLimit(`save:${user.id}`, 60, 60_000);
  if (!limit.ok) return { error: tooMany(limit.retryInSec) };
  const target = parseEuros(str(form, 'target'));
  if (target.error) return { error: target.error };
  const input: ItemInput = {
    title: str(form, 'title'),
    pcProductId: productId(form, 'pcProductId', 'usePc'),
    ps5ProductId: productId(form, 'ps5ProductId', 'usePs5'),
    targetCents: target.cents,
    priority: Number(str(form, 'priority')) || 2,
    edition: str(form, 'edition') || null,
    notes: str(form, 'notes'),
  };
  const id = str(form, 'id');
  try {
    if (id) await updateItem(getDb(), user.id, id, input);
    else await addItem(getDb(), user.id, input);
  } catch (e) {
    if (e instanceof InputError) return { error: e.message };
    throw e;
  }
  revalidatePath('/wishlist');
  return { ok: id ? 'Modifications enregistrées.' : 'Jeu ajouté. Ses prix arrivent dans quelques secondes.' };
}

export async function deleteItemAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteItem(getDb(), user.id, id);
  revalidatePath('/wishlist');
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllRead(getDb(), user.id);
  revalidatePath('/', 'layout');
}

export async function clearNotificationsAction(): Promise<void> {
  const user = await requireUser();
  await clearNotifications(getDb(), user.id);
  revalidatePath('/', 'layout');
}
