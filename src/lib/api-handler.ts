import { NextRequest, NextResponse } from 'next/server';
import { AppError } from './api-error';

type ApiHandler = (
  request: NextRequest,
  context: { params: any },
) => Promise<NextResponse> | NextResponse;

export function apiHandler(handler: ApiHandler) {
  return async (request: NextRequest, context: { params: any }) => {
    try {
      return await handler(request, context);
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
