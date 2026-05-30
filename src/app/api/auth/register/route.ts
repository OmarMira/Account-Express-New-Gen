import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/sessions';
import { apiHandler } from '@/lib/api-handler';
import { validateRequest } from '@/lib/validate-request';
import { registerSchema } from '@/lib/validations/auth';
import { AuthService } from '@/services/auth.service';

// ─── POST /api/auth/register ──────────────────────────────────────────
export const POST = apiHandler(async (request: NextRequest) => {
  const body = await validateRequest(request, registerSchema);
  if (body instanceof NextResponse) return body;
  const result = await AuthService.register(body);

  // Create session token
  const token = await createSession(result.user.id);

  const response = NextResponse.json({
    user: {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role,
    },
    companies: [
      {
        id: result.company.id,
        legalName: result.company.legalName,
        taxId: result.company.taxId,
        isOnboardingComplete: result.company.isOnboardingComplete,
      },
    ],
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
