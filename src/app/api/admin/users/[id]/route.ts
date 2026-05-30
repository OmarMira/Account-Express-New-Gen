import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { hashPassword } from '@/lib/auth';
import { saveLogo, deleteLogo } from '@/lib/uploads/logo-service';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionUserId = await getSessionUserId(request);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionUser = await db.user.findUnique({ where: { id: sessionUserId } });
    if (!sessionUser || sessionUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const contentType = request.headers.get('content-type') || '';
    let firstName,
      lastName,
      email,
      role,
      isActive,
      password,
      phone,
      streetLine1,
      streetLine2,
      city,
      state,
      zipCode,
      avatarCleared,
      avatarFile;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      firstName = formData.get('firstName') as string | null;
      lastName = formData.get('lastName') as string | null;
      email = formData.get('email') as string | null;
      role = formData.get('role') as string | null;
      isActive =
        formData.get('isActive') !== null ? formData.get('isActive') === 'true' : undefined;
      password = formData.get('password') as string | null;
      phone = formData.get('phone') as string | null;
      streetLine1 = formData.get('streetLine1') as string | null;
      streetLine2 = formData.get('streetLine2') as string | null;
      city = formData.get('city') as string | null;
      state = formData.get('state') as string | null;
      zipCode = formData.get('zipCode') as string | null;
      avatarCleared = formData.get('avatarCleared') === 'true';
      avatarFile = formData.get('avatar') as File | null;
    } else {
      const body = await request.json();
      firstName = body.firstName;
      lastName = body.lastName;
      email = body.email;
      role = body.role;
      isActive = body.isActive;
      password = body.password;
      phone = body.phone;
      streetLine1 = body.streetLine1;
      streetLine2 = body.streetLine2;
      city = body.city;
      state = body.state;
      zipCode = body.zipCode;
      avatarCleared = body.avatarCleared === true;
      avatarFile = null;
    }

    const userExists = await db.user.findUnique({
      where: { id },
      select: { avatar: true },
    });

    if (!userExists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let newAvatarPath: string | undefined = undefined;
    let shouldUpdateAvatar = false;

    if (avatarFile && avatarFile.size > 0) {
      newAvatarPath = await saveLogo(avatarFile);
      if (userExists.avatar) {
        await deleteLogo(userExists.avatar);
      }
      shouldUpdateAvatar = true;
    } else if (avatarCleared) {
      newAvatarPath = '';
      if (userExists.avatar) {
        await deleteLogo(userExists.avatar);
      }
      shouldUpdateAvatar = true;
    }

    const data: any = {};
    if (firstName !== undefined && firstName !== null) data.firstName = firstName.trim();
    if (lastName !== undefined && lastName !== null) data.lastName = lastName.trim();
    if (email !== undefined && email !== null) data.email = email.toLowerCase().trim();
    if (role !== undefined && role !== null) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;
    if (password !== undefined && password !== null && password.trim() !== '') {
      data.passwordHash = await hashPassword(password);
    }
    if (phone !== undefined && phone !== null) data.phone = phone.trim();
    if (streetLine1 !== undefined && streetLine1 !== null) data.streetLine1 = streetLine1.trim();
    if (streetLine2 !== undefined && streetLine2 !== null) data.streetLine2 = streetLine2.trim();
    if (city !== undefined && city !== null) data.city = city.trim();
    if (state !== undefined && state !== null) data.state = state;
    if (zipCode !== undefined && zipCode !== null) data.zipCode = zipCode.trim();
    if (shouldUpdateAvatar) {
      data.avatar = newAvatarPath === '' ? '' : newAvatarPath;
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
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUserId = await getSessionUserId(request);
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
