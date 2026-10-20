/** Input checks shared by the forms. Each returns an error message in French, or null. */

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function checkEmail(email: string): string | null {
  const e = normalizeEmail(email);
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Adresse email invalide.';
  return null;
}

export function checkPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  if (password.length > MAX_PASSWORD) return `Le mot de passe doit faire au plus ${MAX_PASSWORD} caractères.`;
  return null;
}

export function checkName(name: string): string | null {
  const n = name.trim();
  if (n.length < 1 || n.length > 40) return 'Le pseudo doit faire entre 1 et 40 caractères.';
  return null;
}

/** "19,99" or "19.99" → 1999 cents. Empty → null. */
export function parseEuros(value: string): { cents: number | null; error: string | null } {
  const v = value.trim().replace(',', '.').replace(/\s|€/g, '');
  if (v === '') return { cents: null, error: null };
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(v)) return { cents: null, error: 'Prix cible invalide (ex. 19,99).' };
  const cents = Math.round(Number(v) * 100);
  return cents > 0 ? { cents, error: null } : { cents: null, error: 'Le prix cible doit être supérieur à 0.' };
}

export const str = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
};
