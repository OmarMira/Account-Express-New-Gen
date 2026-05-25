import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/sessions';
import { apiHandler } from '@/lib/api-handler';
import { validateRequest } from '@/lib/validate-request';
import { loginSchema } from '@/lib/validations/auth';
import { AuthService } from '@/services/auth.service';

// ─── POST /api/auth/login ─────────────────────────────────────────────
export const POST = apiHandler(async (request: NextRequest) => {
  const body = await validateRequest(request, loginSchema);
  const result = await AuthService.login(body);

  // Create session token using shared module
  const token = await createSession(result.user.id);

  const response = NextResponse.json({
    user: result.user,
    companies: result.companies,
  });

  // Set httpOnly cookie
  response.cookies.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });

  return response;
});
