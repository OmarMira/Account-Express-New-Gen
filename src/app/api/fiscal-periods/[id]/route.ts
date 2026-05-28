import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { db } from '@/lib/db';
import { companySettingsCache } from '@/lib/cache';

export const PATCH = apiHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const { companyId, isLocked } = await req.json();

    if (!companyId || isLocked === undefined) {
      return NextResponse.json({ error: 'Campos requeridos faltantes' }, { status: 400 });
    }

    // Si se está desbloqueando, validar que no haya un cierre de ejercicio posterior
    if (isLocked === false) {
      const period = await db.fiscalPeriod.findUnique({ where: { id } });
      if (period) {
        const yearClosed = await db.auditLog.findFirst({
          where: {
            companyId,
            action: 'YEAR_CLOSED',
            createdAt: { gte: period.endDate },
          },
        });
        if (yearClosed) {
          return NextResponse.json(
            { error: 'No se puede desbloquear. Existe un cierre de ejercicio posterior.' },
            { status: 400 },
          );
        }
      }
    }

    const updated = await db.fiscalPeriod.update({
      where: { id },
      data: { isLocked },
    });

    // Invalidar caché
    companySettingsCache.invalidate(companyId);

    await db.auditLog.create({
      data: {
        companyId,
        action: isLocked ? 'PERIOD_LOCKED' : 'PERIOD_UNLOCKED',
        entity: 'FiscalPeriod',
        entityId: id,
      },
    });

    return NextResponse.json({ period: updated });
  },
);
