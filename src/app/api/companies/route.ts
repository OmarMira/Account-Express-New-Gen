import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCurrentUserId } from '@/lib/context-storage';
import { createAuditLogWithRetry } from '@/lib/audit';
import { seedChartOfAccounts } from '@/lib/chart-of-accounts';

export const POST = apiHandler(
  async (request: NextRequest, context: RouteContext) => {
    const userId = requireCurrentUserId();

    const body = await request.json();
    const { legalName, taxId } = body;

    if (!legalName || !legalName.trim()) {
      return NextResponse.json({ error: 'legalName is required' }, { status: 400 });
    }

    const company = await db.$transaction(async (tx) => {
      // 1. Create company
      const newCompany = await tx.company.create({
        data: {
          legalName: legalName.trim(),
          taxId: taxId?.trim() || null,
          isActive: true,
        },
      });

      // 2. Create membership
      await tx.companyMember.create({
        data: {
          userId,
          companyId: newCompany.id,
          role: 'company_admin',
        },
      });

      // 3. Seed accounts
      await seedChartOfAccounts(tx, newCompany.id);

      // 5. Create audit log
      await createAuditLogWithRetry(
        {
          companyId: newCompany.id,
          userId,
          action: 'create_company',
          entity: 'Company',
          entityId: newCompany.id,
          details: `Created company ${newCompany.legalName} and auto-seeded chart of accounts`,
        },
        tx,
      );

      return newCompany;
    });

    return NextResponse.json({ company }, { status: 201 });
  },
  { requireMembership: false },
);
