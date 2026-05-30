import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { getSessionUserId } from '@/lib/sessions';
import { saveLogo } from '@/lib/uploads/logo-service';

export async function GET(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = await db.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        phone: true,
        streetLine1: true,
        streetLine2: true,
        city: true,
        state: true,
        zipCode: true,
        avatar: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('[ADMIN USERS GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') || '';
    let email = '';
    let firstName = '';
    let lastName = '';
    let password = '';
    let role = 'company_admin';
    let phone = '';
    let streetLine1 = '';
    let streetLine2 = '';
    let city = '';
    let state = '';
    let zipCode = '';
    let avatarFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      email = (formData.get('email') as string) || '';
      firstName = (formData.get('firstName') as string) || '';
      lastName = (formData.get('lastName') as string) || '';
      password = (formData.get('password') as string) || '';
      role = (formData.get('role') as string) || 'company_admin';
      phone = (formData.get('phone') as string) || '';
      streetLine1 = (formData.get('streetLine1') as string) || '';
      streetLine2 = (formData.get('streetLine2') as string) || '';
      city = (formData.get('city') as string) || '';
      state = (formData.get('state') as string) || '';
      zipCode = (formData.get('zipCode') as string) || '';
      avatarFile = formData.get('avatar') as File | null;
    } else {
      const body = await request.json();
      email = body.email || '';
      firstName = body.firstName || '';
      lastName = body.lastName || '';
      password = body.password || '';
      role = body.role || 'company_admin';
      phone = body.phone || '';
      streetLine1 = body.streetLine1 || '';
      streetLine2 = body.streetLine2 || '';
      city = body.city || '';
      state = body.state || '';
      zipCode = body.zipCode || '';
    }

    if (!email || !firstName || !lastName || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const existingUser = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    let avatarPath = '';
    if (avatarFile && avatarFile.size > 0) {
      avatarPath = await saveLogo(avatarFile);
    }

    const newUser = await db.user.create({
      data: {
        email: email.toLowerCase().trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        passwordHash,
        role: role || 'company_admin',
        isActive: true,
        phone,
        streetLine1,
        streetLine2,
        city,
        state,
        zipCode,
        avatar: avatarPath,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        phone: true,
        streetLine1: true,
        streetLine2: true,
        city: true,
        state: true,
        zipCode: true,
        avatar: true,
      },
    });

    await db.auditLog.create({
      data: {
        userId,
        action: 'create_user',
        entity: 'User',
        entityId: newUser.id,
        details: `Created user ${newUser.email}`,
      },
    });

    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    console.error('[ADMIN USERS POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
