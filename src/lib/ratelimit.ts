/**
 * In-memory rate limiting (fixed window). Enough for a single home server;
 * counters reset when the site restarts.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): { ok: boolean; retryInSec: number } {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return { ok: true, retryInSec: 0 };
  }
  w.count++;
  return w.count <= max ? { ok: true, retryInSec: 0 } : { ok: false, retryInSec: Math.ceil((w.resetAt - now) / 1000) };
}

export const tooMany = (retryInSec: number): string =>
  `Trop de tentatives. Réessaie dans ${retryInSec < 90 ? `${retryInSec} secondes` : `${Math.ceil(retryInSec / 60)} minutes`}.`;
