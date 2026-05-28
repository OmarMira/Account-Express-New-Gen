import { NextRequest, NextResponse } from 'next/server';
import { AppError } from './api-error';

import { getSessionUserId } from './sessions';
import { checkRateLimit } from './security/rate-limiter';

type ApiHandler = (
  request: NextRequest,
  context: { params: any },
) => Promise<NextResponse> | NextResponse;

export function apiHandler(handler: ApiHandler) {
  return async (request: NextRequest, context: { params: any }) => {
    try {
      // 1. Obtener identificador único (sesión de usuario o IP para anónimos)
      const userId =
        (await getSessionUserId(request)) || request.headers.get('x-forwarded-for') || 'anonymous';
      const { searchParams } = new URL(request.url);
      const companyId = searchParams.get('companyId') || 'global';

      // 2. Ejecutar validación de rate limit
      const { allowed, limit, remaining, resetAt } = checkRateLimit(
        userId,
        companyId,
        request.nextUrl.pathname,
      );
      if (!allowed) {
        return NextResponse.json(
          { error: '429 Too Many Requests', retryAfter: resetAt },
          {
            status: 429,
            headers: {
              'Retry-After': resetAt.toString(),
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': resetAt.toString(),
            },
          },
        );
      }

      const response = await handler(request, context);

      // 3. Inyectar cabeceras informativas del rate limit
      if (response && response.headers) {
        response.headers.set('X-RateLimit-Limit', limit.toString());
        response.headers.set('X-RateLimit-Remaining', remaining.toString());
        response.headers.set('X-RateLimit-Reset', resetAt.toString());
      }

      return response;
    } catch (error: any) {
      if (error instanceof AppError || (error && typeof error.statusCode === 'number')) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            details: error.details,
          },
          { status: error.statusCode },
        );
      }

      // Handle raw Prisma errors (like foreign key constraint or unique constraint violations)
      if (error.code && error.clientVersion) {
        // This is a Prisma error
        console.error('[PRISMA DB ERROR]', error);
        return NextResponse.json(
          {
            error: 'Database constraint violation or error occurred.',
            code: 'DATABASE_ERROR',
          },
          { status: 400 },
        );
      }

      console.error('[UNHANDLED API ERROR]', error);
      return NextResponse.json(
        {
          error: 'Internal server error',
          code: 'INTERNAL_SERVER_ERROR',
        },
        { status: 500 },
      );
    }
  };
}
