/**
 * In-memory rate limiter.
 * Tracks attempts per IP per endpoint with automatic cleanup of expired entries.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000; // 1 minute window

const limits: Record<string, number> = {
  login: 5,
  register: 3,
};

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60_000;

if (typeof globalThis !== 'undefined' && typeof setInterval === 'function') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

export function checkRateLimit(
  ip: string,
  endpoint: string,
): { allowed: boolean; retryAfterMs: number } {
  const maxAttempts = limits[endpoint] ?? 10;
  const key = `${ip}:${endpoint}`;
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    // New window
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= maxAttempts) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}
