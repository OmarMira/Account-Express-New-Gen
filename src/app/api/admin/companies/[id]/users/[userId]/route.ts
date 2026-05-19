import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const sessionUserId = getSessionUserId(request);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: sessionUserId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id: companyId, userId: targetUserId } = await params;

    const member = await db.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: targetUserId,
          companyId,
        },
      },
      include: {
        user: { select: { email: true } },
      },
    });

    if (!member) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    await db.companyMember.delete({
      where: {
        userId_companyId: {
          userId: targetUserId,
          companyId,
        },
      },
    });

    await db.auditLog.create({
      data: {
        companyId,
        userId: sessionUserId,
        action: 'revoke_user_company',
        entity: 'CompanyMember',
        entityId: member.id,
        details: `Revoked user ${member.user.email} from company`,
      },
    });

    return NextResponse.json({ message: 'User access revoked successfully' });
  } catch (error) {
    console.error('[ADMIN COMPANY MEMBERS DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
