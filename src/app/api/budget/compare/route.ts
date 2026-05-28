import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { getVarianceReport } from '@/lib/budget/engine';
import { getSessionUserId } from '@/lib/sessions';
import { db } from '@/lib/db';

export const GET = apiHandler(async (req: NextRequest) => {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('companyId');
  const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString(), 10);
  const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString(), 10);

  if (!companyId) {
    return NextResponse.json({ error: 'companyId es requerido' }, { status: 400 });
  }

  // Verificar membresía del usuario
  const membership = await db.companyMember.findFirst({
    where: { userId, companyId },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const report = await getVarianceReport(companyId, year, month);

  return NextResponse.json({
    period: `${year}-${month}`,
    data: report,
    generatedAt: new Date().toISOString(),
  });
});
