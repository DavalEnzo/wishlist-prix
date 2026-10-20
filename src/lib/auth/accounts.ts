/**
 * Accounts and sessions, independent of Next.js so they can be tested and
 * reused by the admin scripts. Every function takes the database explicitly.
 */
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import { passwordResets, sessions, users, type User } from '../db/schema.ts';
import { checkEmail, checkName, checkPassword, normalizeEmail } from '../validate.ts';
import { burnPasswordCheck, hashPassword, randomToken, sha256, verifyPassword } from './crypto.ts';

export const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;
const RESET_MINUTES = 60;

export class AuthError extends Error {}

/* ---------- Sessions ---------- */

export async function createSession(db: DB, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

/**
 * Returns the user behind a session cookie, or null. Sessions slide: past
 * half their life they are extended, and `renewedUntil` tells the caller to
 * refresh the cookie.
 */
export async function validateSession(db: DB, token: string): Promise<{ user: User; renewedUntil: Date | null } | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (row.expiresAt.getTime() - now < (SESSION_DAYS / 2) * DAY_MS) {
    const renewedUntil = new Date(now + SESSION_DAYS * DAY_MS);
    await db.update(sessions).set({ expiresAt: renewedUntil }).where(eq(sessions.id, id));
    return { user: row.user, renewedUntil };
  }
  return { user: row.user, renewedUntil: null };
}

export async function deleteSession(db: DB, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

/** Signs out every device, optionally keeping the current one. */
export async function deleteUserSessions(db: DB, userId: string, keepToken?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(keepToken ? and(eq(sessions.userId, userId), ne(sessions.id, sha256(keepToken))) : eq(sessions.userId, userId));
}

export async function purgeExpired(db: DB): Promise<void> {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(passwordResets).where(lt(passwordResets.expiresAt, now));
}

/* ---------- Email + password ---------- */

export async function registerWithEmail(db: DB, input: { name: string; email: string; password: string }): Promise<User> {
  const problem = checkName(input.name) ?? checkEmail(input.email) ?? checkPassword(input.password);
  if (problem) throw new AuthError(problem);
  const email = normalizeEmail(input.email);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new AuthError('Un compte existe déjà avec cette adresse. Connecte-toi ou réinitialise ton mot de passe.');
  const [user] = await db
    .insert(users)
    .values({ name: input.name.trim(), email, passwordHash: await hashPassword(input.password) })
    .onConflictDoNothing()
    .returning();
  if (!user) throw new AuthError('Un compte existe déjà avec cette adresse.');
  return user;
}

export async function loginWithEmail(db: DB, emailInput: string, password: string): Promise<User> {
  const email = normalizeEmail(emailInput);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user?.passwordHash) {
    await burnPasswordCheck(password);
    throw new AuthError('Email ou mot de passe incorrect.');
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw new AuthError('Email ou mot de passe incorrect.');
  return user;
}

/** Change the password (current one required), or add email + password to a Discord-only account. */
export async function setPassword(
  db: DB,
  user: User,
  input: { current?: string; email?: string; password: string },
  keepToken?: string,
): Promise<void> {
  const problem = checkPassword(input.password);
  if (problem) throw new AuthError(problem);
  const values: Partial<User> = { passwordHash: await hashPassword(input.password) };
  if (user.passwordHash) {
    if (!input.current || !(await verifyPassword(input.current, user.passwordHash))) throw new AuthError('Mot de passe actuel incorrect.');
  }
  if (!user.email) {
    const emailProblem = checkEmail(input.email ?? '');
    if (emailProblem) throw new AuthError(emailProblem);
    const email = normalizeEmail(input.email as string);
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (taken) throw new AuthError('Cette adresse est déjà utilisée par un autre compte.');
    values.email = email;
  }
  await db.update(users).set(values).where(eq(users.id, user.id));
  await deleteUserSessions(db, user.id, keepToken);
}

/* ---------- Password reset ---------- */

/** Returns a one-time token, or null when no account has this email (the caller must not reveal which). */
export async function createPasswordReset(db: DB, emailInput: string): Promise<{ token: string; user: User } | null> {
  const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(emailInput))).limit(1);
  if (!user) return null;
  return { token: await createResetForUser(db, user.id), user };
}

export async function createResetForUser(db: DB, userId: string): Promise<string> {
  const token = randomToken();
  await db.delete(passwordResets).where(eq(passwordResets.userId, userId));
  await db.insert(passwordResets).values({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) });
  return token;
}

export async function resetPasswordWithToken(db: DB, token: string, password: string): Promise<User> {
  const problem = checkPassword(password);
  if (problem) throw new AuthError(problem);
  const [reset] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, sha256(token)), gt(passwordResets.expiresAt, new Date())))
    .limit(1);
  if (!reset) throw new AuthError('Ce lien a expiré ou a déjà servi. Demande un nouveau lien.');
  await db.delete(passwordResets).where(eq(passwordResets.userId, reset.userId));
  const [user] = await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, reset.userId)).returning();
  if (!user) throw new AuthError('Compte introuvable.');
  await deleteUserSessions(db, user.id);
  return user;
}

/* ---------- Discord ---------- */

export interface DiscordProfile {
  id: string;
  name: string;
  avatar: string | null;
}

/** Signs in with Discord. Returns null when the account does not exist and may not be created. */
export async function signInWithDiscord(db: DB, profile: DiscordProfile, allowCreate: boolean): Promise<User | null> {
  const [existing] = await db.select().from(users).where(eq(users.discordId, profile.id)).limit(1);
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ discordName: profile.name, discordAvatar: profile.avatar })
      .where(eq(users.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  if (!allowCreate) return null;
  const [created] = await db
    .insert(users)
    .values({ name: profile.name.slice(0, 40) || 'Joueur', discordId: profile.id, discordName: profile.name, discordAvatar: profile.avatar })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db.select().from(users).where(eq(users.discordId, profile.id)).limit(1);
  return raced ?? null;
}

export async function linkDiscord(db: DB, userId: string, profile: DiscordProfile): Promise<void> {
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, profile.id)).limit(1);
  if (owner && owner.id !== userId) throw new AuthError('Ce compte Discord est déjà relié à un autre compte du site.');
  await db
    .update(users)
    .set({ discordId: profile.id, discordName: profile.name, discordAvatar: profile.avatar, dmError: null })
    .where(eq(users.id, userId));
}

export async function unlinkDiscord(db: DB, user: User): Promise<void> {
  if (!user.passwordHash || !user.email) throw new AuthError('Ajoute d’abord un email et un mot de passe : sinon tu ne pourrais plus te connecter.');
  await db.update(users).set({ discordId: null, discordName: null, discordAvatar: null, dmError: null }).where(eq(users.id, user.id));
}

export async function deleteAccount(db: DB, userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
