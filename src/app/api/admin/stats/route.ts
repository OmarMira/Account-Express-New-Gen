import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

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

    const [companiesCount, usersCount, logsCount] = await Promise.all([
      db.company.count(),
      db.user.count(),
      db.auditLog.count(),
    ]);

    return NextResponse.json({
      companiesCount,
      usersCount,
      logsCount,
    });
  } catch (error) {
    console.error('[ADMIN STATS GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
