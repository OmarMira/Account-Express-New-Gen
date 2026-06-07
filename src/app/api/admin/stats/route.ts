import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';

export const GET = apiHandler(
  async (request: NextRequest, context: { params: any }) => {
    const { userId, companyId } = requireCompanyContext();

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
  },
  { requireSuperAdmin: true },
);
