import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';

export const GET = apiHandler(
  async (request: NextRequest, context: { params: any }) => {
    const { userId } = requireCompanyContext();

    const { id: companyId } = await context.params;

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
  },
  { requireSuperAdmin: true },
);

export const POST = apiHandler(
  async (request: NextRequest, context: { params: any }) => {
    const { userId } = requireCompanyContext();

    const { id: companyId } = await context.params;
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
  },
  { requireSuperAdmin: true },
);
