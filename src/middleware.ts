import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authRateLimiter } from '@/lib/rate-limiter';

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // 1. CSRF Protection for API Mutations (POST, PUT, PATCH, DELETE)
  if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const host = request.headers.get('host');

    // Construir origen local esperado basado en la cabecera Host
    const expectedOrigin = host ? `http://${host}` : null;
    const expectedOriginHttps = host ? `https://${host}` : null;

    if (origin) {
      if (origin !== expectedOrigin && origin !== expectedOriginHttps) {
        return new NextResponse(
          JSON.stringify({ error: 'CSRF validation failed: Origin mismatch', code: 'CSRF_ERROR' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
    } else if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (refererUrl.host !== host) {
          return new NextResponse(
            JSON.stringify({
              error: 'CSRF validation failed: Referer mismatch',
              code: 'CSRF_ERROR',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          );
        }
      } catch {
        return new NextResponse(
          JSON.stringify({
            error: 'CSRF validation failed: Invalid referer header',
            code: 'CSRF_ERROR',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
    } else {
      // Bloquear si no hay origin ni referer en peticiones que modifican datos
      return new NextResponse(
        JSON.stringify({
          error: 'CSRF validation failed: Missing origin or referer header',
          code: 'CSRF_ERROR',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // 2. Rate Limiting for Auth Endpoints (/api/auth/login y /api/auth/register)
  if (pathname === '/api/auth/login' || pathname === '/api/auth/register') {
    const ip =
      (request as any).ip || request.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
    let email: string | undefined;

    try {
      const body = await request.clone().json();
      if (body && typeof body.email === 'string') {
        email = body.email;
      }
    } catch {
      // No hacer nada si falla el parseo
    }

    const rateLimitCheck = authRateLimiter.check(ip, email);
    if (!rateLimitCheck.success) {
      const resetTime = rateLimitCheck.resetTime
        ? new Date(rateLimitCheck.resetTime).toISOString()
        : 'unknown';
      return new NextResponse(
        JSON.stringify({
          error: `Too many login/registration attempts. Blocked by ${rateLimitCheck.limitType}. Retry after ${resetTime}`,
          code: 'RATE_LIMIT_EXCEEDED',
          details: { limitType: rateLimitCheck.limitType, resetTime },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Incrementar hits
    authRateLimiter.increment(ip, email);
  }

  // 3. Apply Security Headers
  const response = NextResponse.next();
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Optimización de cache para assets estáticos de Next.js
  if (request.nextUrl.pathname.startsWith('/_next/static')) {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  return response;
}

// Configuración del matcher del middleware
export const config = {
  matcher: ['/((?!_next/image|favicon.ico).*)'],
};
