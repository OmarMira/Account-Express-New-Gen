import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { db } from '@/lib/db';
import { companySettingsCache } from '@/lib/cache';

export const POST = apiHandler(async (req: NextRequest) => {
  const { companyId, name, startDate, endDate } = await req.json();

  if (!companyId || !name || !startDate || !endDate) {
    return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Validar solapamientos
  const existing = await db.fiscalPeriod.findMany({ where: { companyId } });
  const overlap = existing.some((e) => !(end < e.startDate || start > e.endDate));
  if (overlap) {
    return NextResponse.json({ error: 'Solapamiento con períodos existentes' }, { status: 409 });
  }

  // Validar nombre único
  const nameExists = existing.some((e) => e.name === name);
  if (nameExists) {
    return NextResponse.json({ error: 'Nombre de período duplicado' }, { status: 409 });
  }

  const period = await db.fiscalPeriod.create({
    data: {
      companyId,
      name,
      startDate: start,
      endDate: end,
      isLocked: false,
    },
  });

  // Invalidar caché
  companySettingsCache.invalidate(companyId);

  await db.auditLog.create({
    data: {
      companyId,
      action: 'PERIOD_CREATED',
      entity: 'FiscalPeriod',
      entityId: period.id,
      details: JSON.stringify({ name, startDate, endDate }),
    },
  });

  return NextResponse.json({ period });
});
