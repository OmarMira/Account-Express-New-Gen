import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id: companyId } = await params;

    // Get current members of company
    const members = await db.companyMember.findMany({
      where: { companyId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
          },
        },
      },
    });

    // Get all users in the system to allow assignment
    const allUsers = await db.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    return NextResponse.json({ members, allUsers });
  } catch (error) {
    console.error('[ADMIN COMPANY MEMBERS GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id: companyId } = await params;
    const body = await request.json();
    const { userId: targetUserId, role = 'company_admin' } = body;

    if (!targetUserId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Check if already a member
    const existing = await db.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: targetUserId,
          companyId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'User is already a member of this company' },
        { status: 400 },
      );
    }

    const member = await db.companyMember.create({
      data: {
        companyId,
        userId: targetUserId,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    await db.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'assign_user_company',
        entity: 'CompanyMember',
        entityId: member.id,
        details: `Assigned user ${member.user.email} to company`,
      },
    });

    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    console.error('[ADMIN COMPANY MEMBERS POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
