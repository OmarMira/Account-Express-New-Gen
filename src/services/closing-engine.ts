import { db } from '@/lib/db';
import { createAuditLogWithRetry } from '@/lib/audit';
import { getPeriodStrategy } from '@/lib/fiscal-period/strategies';
import { FiscalYearConfig } from '@/lib/fiscal-period/types';

export async function executeYearClose(companyId: string, year: number, config: FiscalYearConfig) {
  const strategy = getPeriodStrategy(config.type);
  const calcPeriods = strategy.calculate({ year, config });
  if (!calcPeriods.length) throw new Error('Estrategia no generó períodos');

  const fiscalStart = calcPeriods[0].startDate; // UTC
  const fiscalEnd = calcPeriods[calcPeriods.length - 1].endDate; // UTC

  const dbPeriods = await db.fiscalPeriod.findMany({
    where: { companyId, startDate: { gte: fiscalStart }, endDate: { lte: fiscalEnd } },
    orderBy: { startDate: 'asc' },
  });
  if (dbPeriods.length !== config.periodsPerYear || !dbPeriods.every((p) => p.isLocked)) {
    throw new Error('Períodos incompletos o no bloqueados');
  }

  const accounts = await db.glAccount.findMany({
    where: { companyId, accountType: { in: ['revenue', 'expense'] }, isActive: true },
  });

  // ⚠️ AGREGACIÓN NATIVA SQLITE
  const netBalances = await Promise.all(
    accounts.map(async (acc) => {
      const totals = await db.journalLine.aggregate({
        _sum: { debit: true, credit: true },
        where: {
          glAccountId: acc.id,
          entry: { companyId, date: { gte: fiscalStart, lte: fiscalEnd }, status: 'posted' },
        },
      });
      const d = totals._sum.debit ?? 0,
        c = totals._sum.credit ?? 0;
      return {
        id: acc.id,
        net: acc.normalBalance === 'credit' ? c - d : d - c,
      };
    }),
  );

  const lines = netBalances
    .filter((b) => Math.abs(b.net) > 0.01)
    .map((b) => ({
      glAccountId: b.id,
      description: `Cierre ${year}`,
      debit: b.net > 0 ? b.net : 0,
      credit: b.net < 0 ? Math.abs(b.net) : 0,
    }));

  const closingAcc = await db.glAccount.findFirst({
    where: { companyId, code: config.closingAccountCode, isActive: true },
  });
  if (!closingAcc) throw new Error('Cuenta de cierre no encontrada');

  const netToRetained = lines.reduce((s, l) => s + l.debit - l.credit, 0);
  lines.push({
    glAccountId: closingAcc.id,
    description: `Traslado utilidades ${year}`,
    debit: netToRetained < 0 ? Math.abs(netToRetained) : 0,
    credit: netToRetained > 0 ? netToRetained : 0,
  });

  if (
    Math.abs(lines.reduce((s, l) => s + l.debit, 0) - lines.reduce((s, l) => s + l.credit, 0)) >
    0.01
  ) {
    throw new Error('Asiento de cierre descuadrado');
  }

  return await db.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        companyId,
        date: fiscalEnd,
        description: `Cierre ${year}`,
        reference: `CLOSE-${year}`,
        status: 'posted',
        lines: { create: lines },
      },
    });
    await createAuditLogWithRetry(
      {
        companyId,
        action: 'YEAR_CLOSED',
        entity: 'JournalEntry',
        entityId: entry.id,
        details: JSON.stringify({ year }),
      },
      tx,
    );
    await tx.fiscalPeriod.updateMany({
      where: { companyId, endDate: { gte: fiscalEnd } },
      data: { isLocked: true },
    });
    return { success: true, entryId: entry.id };
  });
}
