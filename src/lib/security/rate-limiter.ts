import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';

type RateLimitConfig = {
  default: { requestsPerMinute: number; burstMultiplier: number };
  criticalEndpoints: Record<string, { requestsPerMinute: number; burstMultiplier: number }>;
  scope: string;
  windowMs: number;
};

// Cache interno de ventanas deslizantes
const requestWindows = new Map<string, { count: number; resetAt: number }>();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Limpieza cada 5 min para evitar memory leaks

setInterval(() => {
  const now = Date.now();
  for (const [key, window] of requestWindows.entries()) {
    if (now >= window.resetAt) requestWindows.delete(key);
  }
}, CLEANUP_INTERVAL);

type SecurityConfig = {
  version: string;
  rateLimit: RateLimitConfig;
};

let cachedConfig: RateLimitConfig | null = null;
let lastLoadedTime = 0;
const CACHE_TTL = 300 * 1000; // 300s TTL in development

function getRateLimitConfig(): RateLimitConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const now = Date.now();

  if (cachedConfig && (isProd || now - lastLoadedTime < CACHE_TTL)) {
    return cachedConfig;
  }

  const configPath = join(process.cwd(), 'rules/security-config.json');
  const fullConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as SecurityConfig;
  cachedConfig = fullConfig.rateLimit;
  lastLoadedTime = now;
  return cachedConfig;
}

export function checkRateLimit(
  userId: string,
  companyId: string,
  path: string,
): { allowed: boolean; limit: number; remaining: number; resetAt: number } {
  try {
    const config = getRateLimitConfig();

    const key = `${userId}:${companyId}`;
    const now = Date.now();

    // Limpieza pasiva activa (in-line garbage collection para evitar memory leaks)
    for (const [winKey, winVal] of requestWindows.entries()) {
      if (now >= winVal.resetAt) {
        requestWindows.delete(winKey);
      }
    }

    // Determinar límite según ruta
    let limit = config.default.requestsPerMinute;
    let burst = config.default.burstMultiplier;
    for (const [prefix, cfg] of Object.entries(config.criticalEndpoints)) {
      if (path.startsWith(prefix)) {
        limit = cfg.requestsPerMinute;
        burst = cfg.burstMultiplier;
        break;
      }
    }

    const maxAllowed = Math.floor(limit * burst);
    const windowKey = `${key}:${path}`;
    let window = requestWindows.get(windowKey);

    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + config.windowMs };
      requestWindows.set(windowKey, window);
    }

    window.count++;
    const remaining = Math.max(0, maxAllowed - window.count);
    const allowed = window.count <= maxAllowed;

    // Auditoría asíncrona de violaciones (con entity obligatoria, no bloquea respuesta)
    if (!allowed) {
      db.auditLog
        .create({
          data: {
            companyId,
            userId,
            action: 'RATE_LIMIT_VIOLATION',
            entity: 'Security',
            details: JSON.stringify({ userId, path, limit: maxAllowed, attempts: window.count }),
          },
        })
        .catch((e) => console.error('[RATE LIMIT AUDIT LOG ERROR]', e));
    }

    return { allowed, limit: maxAllowed, remaining, resetAt: Math.ceil(window.resetAt / 1000) };
  } catch (error) {
    console.error('[RATE LIMIT ERROR] Fail-safe active, allowing request:', error);
    // Fail-safe: Si hay algún error, permitimos la petición para no bloquear el sistema contable
    return {
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: Math.ceil((Date.now() + 60000) / 1000),
    };
  }
}
