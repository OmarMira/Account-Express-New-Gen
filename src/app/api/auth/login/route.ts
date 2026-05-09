import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSession } from '@/lib/sessions';
import { checkRateLimit } from '@/lib/rate-limit';

// ─── POST /api/auth/login ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // Rate limiting before password check
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const rateResult = checkRateLimit(ip, 'login');
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.', retryAfterMs: rateResult.retryAfterMs },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        passwordHash: true,
        companyMemberships: {
          where: { company: { isActive: true } },
          include: {
            company: {
              select: { id: true, legalName: true, taxId: true, isActive: true },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Create session token using shared module
    const token = await createSession(user.id);

    const companies = user.companyMemberships.map((m) => m.company);

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      companies,
    });

    // Set httpOnly cookie
    response.cookies.set('session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error) {
    console.error('[AUTH LOGIN ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
