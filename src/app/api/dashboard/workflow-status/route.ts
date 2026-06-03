import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { hasCompanyAccess } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
    }

    const hasAccess = await hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const accountsCount = await db.glAccount.count({ where: { companyId } });
    const banksCount = await db.bankAccount.count({ where: { companyId } });
    const importCount = await db.bankTransaction.count({ where: { statement: { companyId } } });
    const rulesCount = await db.bankRule.count({ where: { companyId } });
    const reconciliationCount = await db.bankTransaction.count({
      where: { statement: { companyId }, isReconciled: true },
    });
    const journalCount = await db.journalEntry.count({ where: { companyId } });

    return NextResponse.json({
      accounts: { completed: accountsCount > 0, count: accountsCount },
      banks: { completed: banksCount > 0, count: banksCount },
      import: { completed: importCount > 0, count: importCount },
      rules: { completed: rulesCount > 0, count: rulesCount },
      reconciliation: { completed: reconciliationCount > 0, count: reconciliationCount },
      journal: { completed: journalCount > 0, count: journalCount },
      reports: { completed: journalCount > 0, count: journalCount },
    });
  } catch (error) {
    console.error('[WORKFLOW STATUS API ERROR]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
