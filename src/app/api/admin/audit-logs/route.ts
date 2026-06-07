import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';

export const GET = apiHandler(
  async (request: NextRequest, context: { params: any }) => {
    const { userId, companyId } = requireCompanyContext();

    const auditLogs = await db.auditLog.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        company: {
          select: {
            id: true,
            legalName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit to last 100 logs for performance
    });

    return NextResponse.json({ auditLogs });
  },
  { requireSuperAdmin: true },
);
