import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { toUTCRange } from '@/lib/reports/date-filter';
import { aggregateFinancialData } from '@/lib/reports/aggregation';

export const GET = apiHandler(async (req: NextRequest) => {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('companyId');
  const type = searchParams.get('type'); // trial_balance | income_statement | balance_sheet
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');

  if (!companyId || !type) {
    return NextResponse.json({ error: 'companyId y type son requeridos' }, { status: 400 });
  }

  // Verificar membresía del usuario
  const membership = await db.companyMember.findFirst({
    where: { userId, companyId },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const { startDate, endDate } = toUTCRange(startDateStr, endDateStr);
    const data = await aggregateFinancialData(companyId, startDate, endDate, type);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
