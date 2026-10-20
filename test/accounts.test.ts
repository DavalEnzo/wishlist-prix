import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import {
  AuthError,
  createPasswordReset,
  createSession,
  deleteUserSessions,
  linkDiscord,
  loginWithEmail,
  registerWithEmail,
  resetPasswordWithToken,
  setPassword,
  signInWithDiscord,
  unlinkDiscord,
  validateSession,
} from '../src/lib/auth/accounts.ts';
import { hashPassword, sha256, verifyPassword } from '../src/lib/auth/crypto.ts';
import type { DB } from '../src/lib/db/index.ts';
import { sessions, users } from '../src/lib/db/schema.ts';
import { createTestDb } from './helpers.ts';

describe('accounts', () => {
  let db: DB;
  let close: () => Promise<void>;
  before(async () => ({ db, close } = await createTestDb()));
  after(() => close());

  it('hashes passwords with scrypt', async () => {
    const h = await hashPassword('un mot de passe solide');
    assert.match(h, /^scrypt:32768:8:1:/);
    assert.equal(await verifyPassword('un mot de passe solide', h), true);
    assert.equal(await verifyPassword('autre chose', h), false);
  });

  it('registers, rejects duplicates and weak passwords, and signs in', async () => {
    const user = await registerWithEmail(db, { name: 'Enzo', email: ' Enzo@Example.FR ', password: 'motdepasse-long' });
    assert.equal(user.email, 'enzo@example.fr');
    await assert.rejects(registerWithEmail(db, { name: 'X', email: 'enzo@example.fr', password: 'motdepasse-long' }), AuthError);
    await assert.rejects(registerWithEmail(db, { name: 'X', email: 'x@example.fr', password: 'court' }), /au moins 10/);
    assert.equal((await loginWithEmail(db, 'ENZO@example.fr', 'motdepasse-long')).id, user.id);
    await assert.rejects(loginWithEmail(db, 'enzo@example.fr', 'mauvais-mot-de-passe'), /incorrect/);
    await assert.rejects(loginWithEmail(db, 'inconnu@example.fr', 'motdepasse-long'), /incorrect/);
  });

  it('stores only a hash of the session token, and expires or renews sessions', async () => {
    const [user] = await db.select().from(users).where(eq(users.email, 'enzo@example.fr'));
    const { token } = await createSession(db, user!.id);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sha256(token)));
    assert.ok(row, 'stored under its hash');
    assert.equal((await validateSession(db, token))?.user.id, user!.id);
    assert.equal(await validateSession(db, 'forged'), null);

    await db.update(sessions).set({ expiresAt: new Date(Date.now() + 2 * 86_400_000) }).where(eq(sessions.id, sha256(token)));
    assert.ok((await validateSession(db, token))?.renewedUntil, 'renewed when close to expiry');
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, sha256(token)));
    assert.equal(await validateSession(db, token), null);
  });

  it('resets a password with a single-use link and signs out every device', async () => {
    const [user] = await db.select().from(users).where(eq(users.email, 'enzo@example.fr'));
    const { token: session } = await createSession(db, user!.id);
    assert.equal(await createPasswordReset(db, 'personne@example.fr'), null);
    const reset = await createPasswordReset(db, 'enzo@example.fr');
    assert.ok(reset);
    await resetPasswordWithToken(db, reset.token, 'nouveau-mot-de-passe');
    await assert.rejects(resetPasswordWithToken(db, reset.token, 'encore-un-autre'), /expiré ou a déjà servi/);
    assert.equal(await validateSession(db, session), null);
    assert.ok(await loginWithEmail(db, 'enzo@example.fr', 'nouveau-mot-de-passe'));
  });

  it('signs up with Discord only when allowed, and links or unlinks safely', async () => {
    const profile = { id: '123456789012345678', name: 'Derba', avatar: null };
    assert.equal(await signInWithDiscord(db, profile, false), null, 'invite code required');
    const discordUser = await signInWithDiscord(db, profile, true);
    assert.equal(discordUser?.discordId, profile.id);
    assert.equal((await signInWithDiscord(db, { ...profile, name: 'Derba2' }, false))?.discordName, 'Derba2', 'existing account signs in');

    const [enzo] = await db.select().from(users).where(eq(users.email, 'enzo@example.fr'));
    await assert.rejects(linkDiscord(db, enzo!.id, profile), /déjà relié/);
    await assert.rejects(unlinkDiscord(db, discordUser!), /Ajoute d’abord un email/);

    await setPassword(db, discordUser!, { email: 'derba@example.fr', password: 'mot-de-passe-derba' });
    const [withEmail] = await db.select().from(users).where(eq(users.id, discordUser!.id));
    await unlinkDiscord(db, withEmail!);
    await linkDiscord(db, enzo!.id, profile);
    const [linked] = await db.select().from(users).where(eq(users.id, enzo!.id));
    assert.equal(linked?.discordId, profile.id);
  });

  it('asks for the current password before changing it', async () => {
    const [enzo] = await db.select().from(users).where(eq(users.email, 'enzo@example.fr'));
    await assert.rejects(setPassword(db, enzo!, { current: 'faux', password: 'encore-plus-long' }), /actuel incorrect/);
    const { token } = await createSession(db, enzo!.id);
    const other = await createSession(db, enzo!.id);
    await setPassword(db, enzo!, { current: 'nouveau-mot-de-passe', password: 'encore-plus-long' }, token);
    assert.ok(await validateSession(db, token), 'current device stays signed in');
    assert.equal(await validateSession(db, other.token), null, 'other devices are signed out');
    await deleteUserSessions(db, enzo!.id);
  });
});
