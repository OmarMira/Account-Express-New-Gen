import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { hashPassword } from '@/lib/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUserId = getSessionUserId(request);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionUser = await db.user.findUnique({ where: { id: sessionUserId } });
    if (!sessionUser || sessionUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { firstName, lastName, email, role, isActive, password } = body;

    const data: any = {};
    if (firstName !== undefined) data.firstName = firstName.trim();
    if (lastName !== undefined) data.lastName = lastName.trim();
    if (email !== undefined) data.email = email.toLowerCase().trim();
    if (role !== undefined) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;
    if (password !== undefined && password.trim() !== '') {
      data.passwordHash = await hashPassword(password);
    }

    const updatedUser = await db.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    await db.auditLog.create({
      data: {
        userId: sessionUserId,
        action: 'update_user',
        entity: 'User',
        entityId: updatedUser.id,
        details: `Updated user ${updatedUser.email}`,
      },
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error('[ADMIN USER PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUserId = getSessionUserId(request);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionUser = await db.user.findUnique({ where: { id: sessionUserId } });
    if (!sessionUser || sessionUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    if (sessionUserId === id) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    const targetUser = await db.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await db.user.delete({ where: { id } });

    await db.auditLog.create({
      data: {
        userId: sessionUserId,
        action: 'delete_user',
        entity: 'User',
        entityId: id,
        details: `Permanently deleted user ${targetUser.email}`,
      },
    });

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('[ADMIN USER DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
