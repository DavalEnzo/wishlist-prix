import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** 32 random bytes, URL-safe: session cookies, reset links, OAuth state. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/* ---------- Passwords (scrypt, built into Node) ---------- */

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Format: scrypt:N:r:p:salt:hash — the parameters travel with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: MAX_MEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split(':');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEM });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Same cost as a real check: an unknown email takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummyHash);
}
