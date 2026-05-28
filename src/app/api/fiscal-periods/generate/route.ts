import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { db } from '@/lib/db';
import { getPeriodStrategy } from '@/lib/fiscal-period/strategies';
import { fiscalConfigSchema } from '@/lib/fiscal-period/types';

export const POST = apiHandler(async (req: NextRequest) => {
  const { companyId, year, config } = await req.json();
  const validated = fiscalConfigSchema.parse(config);
  const strategy = getPeriodStrategy(validated.type);
  const calculated = strategy.calculate({ year, config: validated });

  // ⚠️ VALIDACIÓN ANTES DE INSERTAR
  const existing = await db.fiscalPeriod.findMany({
    where: { companyId },
    select: { name: true, startDate: true, endDate: true },
  });
  const conflict = calculated.find((p) =>
    existing.some(
      (e) => e.name === p.name || !(p.endDate < e.startDate || p.startDate > e.endDate),
    ),
  );
  if (conflict)
    return NextResponse.json({ error: 'Conflicto de período o nombre duplicado' }, { status: 409 });

  const created = await db.$transaction(
    calculated.map(({ isShort, ...p }) => db.fiscalPeriod.create({ data: { companyId, ...p } })),
  );

  await db.auditLog.create({
    data: {
      companyId,
      action: 'PERIODS_GENERATED',
      entity: 'FiscalPeriod',
      details: JSON.stringify({ year, count: created.length }),
    },
  });
  return NextResponse.json({ periods: created });
});
