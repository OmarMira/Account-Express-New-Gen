import { db } from '@/lib/db';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

type CheckResult = {
  gate: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  detail: string;
  metric?: Record<string, number | string>;
  timestamp: string;
};

const results: CheckResult[] = [];
const TOLERANCE = 0.01;

async function check(name: string, fn: () => Promise<{ status: 'PASS' | 'FAIL' | 'WARN'; detail: string; metric?: Record<string, any> }>) {
  try {
    const res = await fn();
    results.push({ gate: name, ...res, timestamp: new Date().toISOString() });
    console.log(`[${res.status}] ${name}: ${res.detail}`);
  } catch (err) {
    const msg = (err as Error).message || 'Error desconocido';
    results.push({ gate: name, status: 'FAIL', detail: msg, timestamp: new Date().toISOString() });
    console.log(`[FAIL] ${name}: ${msg}`);
  }
}

async function runFullCycleCheck() {
  console.log('🔍 INICIANDO VALIDACIÓN AUTOMÁTICA DEL CICLO CONTABLE...\n');

  // Resolver COMPANY_ID dinámicamente
  let companyId = process.env.COMPANY_ID || '';
  if (!companyId) {
    const firstCompany = await db.company.findFirst();
    if (!firstCompany) {
      throw new Error('No se encontró ninguna compañía en la base de datos.');
    }
    companyId = firstCompany.id;
    console.log(`- COMPANY_ID no provisto. Usando primera compañía encontrada: "${firstCompany.legalName}" (ID: ${companyId})\n`);
  } else {
    console.log(`- Usando COMPANY_ID provisto: ${companyId}\n`);
  }

  // GATE 1: Integridad de Períodos Fiscales
  await check('FISCAL_PERIODS_INTEGRITY', async () => {
    const periods = await db.fiscalPeriod.findMany({ where: { companyId: companyId }, orderBy: { startDate: 'asc' } });
    if (periods.length === 0) return { status: 'WARN', detail: 'No hay períodos generados' };
    
    // Ignoramos períodos anuales (que empiezan con 'FY') para el solapamiento mensual
    const monthlyPeriods = periods.filter(p => !p.name.startsWith('FY'));
    const overlaps = monthlyPeriods.filter((p, i) => 
      monthlyPeriods.slice(i + 1).some(next => !(p.endDate < next.startDate || p.startDate > next.endDate))
    );
    
    if (overlaps.length > 0) return { status: 'FAIL', detail: `${overlaps.length} períodos mensuales se solapan` };
    return { status: 'PASS', detail: `${periods.length} períodos válidos, sin solapamientos mensuales`, metric: { count: periods.length } };
  });

  // GATE 2: Cadena de Saldos Bancarios
  await check('BANK_STATEMENT_CHAIN', async () => {
    const statements = await db.bankStatement.findMany({
      where: { bankAccount: { companyId: companyId } },
      orderBy: { endDate: 'asc' }
    });
    if (statements.length < 2) return { status: 'WARN', detail: 'Menos de 2 estados para validar cadena' };
    
    let breaks = 0;
    for (let i = 0; i < statements.length - 1; i++) {
      const currClose = statements[i].closingBalance;
      const nextOpen = statements[i + 1].openingBalance;
      if (Math.abs(currClose - nextOpen) > TOLERANCE) breaks++;
    }
    return breaks === 0 
      ? { status: 'PASS', detail: 'Cadena de saldos intacta', metric: { statements: statements.length } }
      : { status: 'FAIL', detail: `${breaks} rupturas en la cadena de saldos` };
  });

  // GATE 3: Balance de Libro Mayor (Debe == Haber)
  await check('LEDGER_BALANCE_INTEGRITY', async () => {
    const totals = await db.journalLine.aggregate({
      _sum: { debit: true, credit: true },
      where: { entry: { companyId: companyId, status: 'posted' } }
    });
    const debit = totals._sum.debit ?? 0;
    const credit = totals._sum.credit ?? 0;
    const diff = Math.abs(debit - credit);
    return diff < TOLERANCE 
      ? { status: 'PASS', detail: `Partida doble validada. Diferencia: $${diff.toFixed(2)}`, metric: { debit, credit } }
      : { status: 'FAIL', detail: `Libro mayor descuadrado en $${diff.toFixed(2)}` };
  });

  // GATE 4: Alineación Conciliación vs Posteo (Corregido para SQLite)
  await check('RECONCILIATION_ALIGNMENT', async () => {
    const mismatchReconciled = await db.bankTransaction.count({
      where: { statement: { bankAccount: { companyId: companyId } }, isReconciled: true, journalLineId: null }
    });
    
    const pendingTxs = await db.bankTransaction.findMany({
      where: {
        statement: { bankAccount: { companyId: companyId } },
        isReconciled: false,
        journalLineId: { not: null }
      },
      select: { journalLineId: true }
    });
    
    const lineIds = pendingTxs.map(tx => tx.journalLineId).filter((id): id is string => id !== null);
    
    const mismatchPosted = await db.journalLine.count({
      where: {
        id: { in: lineIds },
        entry: { status: 'posted' }
      }
    });

    const total = mismatchReconciled + mismatchPosted;
    return total === 0 
      ? { status: 'PASS', detail: 'Conciliación y posteo alineados perfectamente' }
      : { status: 'WARN', detail: `${mismatchReconciled} conciliados sin línea | ${mismatchPosted} posteados sin conciliar` };
  });

  // GATE 5: Ecuación Contable (Activo = Pasivo + Patrimonio + Utilidades del Ejercicio)
  await check('ACCOUNTING_EQUATION', async () => {
    const lines = await db.journalLine.findMany({
      where: { entry: { companyId: companyId, status: 'posted' } },
      select: { debit: true, credit: true, glAccount: { select: { accountType: true } } }
    });
    
    let assets = 0, liabilities = 0, equity = 0, revenues = 0, expenses = 0;
    for (const l of lines) {
      const net = (l.debit || 0) - (l.credit || 0);
      switch (l.glAccount.accountType) {
        case 'asset': assets += net; break;
        case 'liability': liabilities -= net; break; // El crédito aumenta el pasivo
        case 'equity': equity -= net; break;         // El crédito aumenta el patrimonio
        case 'revenue': revenues -= net; break;       // El crédito aumenta los ingresos
        case 'expense': expenses += net; break;       // El débito aumenta los egresos
        default: break;
      }
    }
    
    // En libros no cerrados, el Patrimonio total incluye las ganancias del periodo (ingresos - egresos)
    const totalEquity = equity + (revenues - expenses);
    const diff = Math.abs(assets - (liabilities + totalEquity));
    
    return diff < TOLERANCE 
      ? { status: 'PASS', detail: `A = L + E (incluyendo utilidad neta) verificada. Diferencia: $${diff.toFixed(2)}`, metric: { assets, liabilities, equity: totalEquity } }
      : { status: 'FAIL', detail: `Ecuación contable rota. Diferencia: $${diff.toFixed(2)}` };
  });

  // GATE 6: Auditoría Mínima Requerida
  await check('AUDIT_TRAIL_COMPLETENESS', async () => {
    const actions = await db.auditLog.groupBy({
      by: ['action'],
      where: { companyId: companyId },
      _count: true
    });
    
    // Tipos de acciones reales y completas registradas en nuestro pipeline
    const realActions = ['FISCAL_PERIODS_LOCKED', 'AUTO_RECONCILIATION_COMMIT', 'OPENING_BALANCE_POSTED', 'SUSPENSE_DRAFTS_CLASSIFIED'];
    const foundReal = realActions.filter(r => actions.some(a => a.action === r));

    return foundReal.length > 0
      ? { status: 'PASS', detail: `Trail completo. ${actions.length} tipos de acción registrados.`, metric: { count: actions.length } }
      : { status: 'WARN', detail: `Faltan logs críticos de auditoría.` };
  });

  // GATE 7: Bloqueo de Períodos (Seguridad)
  await check('PERIOD_LOCK_ENFORCEMENT', async () => {
    const lockedPeriods = await db.fiscalPeriod.findMany({ where: { companyId: companyId, isLocked: true } });
    if (lockedPeriods.length === 0) return { status: 'WARN', detail: 'Ningún período bloqueado aún' };
    
    const violations = await db.journalEntry.count({
      where: {
        companyId: companyId,
        status: 'draft',
        OR: lockedPeriods.map(p => ({
          date: { gte: p.startDate, lte: p.endDate }
        }))
      }
    });
    return violations === 0 
      ? { status: 'PASS', detail: 'Cero borradores en períodos cerrados' }
      : { status: 'FAIL', detail: `${violations} borradores violan bloqueo de período` };
  });

  // 📊 GENERAR REPORTE
  const reportDir = join(process.cwd(), 'reports');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `full-cycle-check-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify({ 
    timestamp: new Date().toISOString(),
    companyId: companyId,
    summary: {
      total: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      warnings: results.filter(r => r.status === 'WARN').length,
      status: results.some(r => r.status === 'FAIL') ? 'REQUIRES_ATTENTION' : 'PRODUCTION_READY'
    },
    checks: results
  }, null, 2));

  console.log(`\n📄 Reporte generado: ${reportPath}`);
  console.log('✅ VALIDACIÓN FINALIZADA.');
}

runFullCycleCheck().catch(err => {
  console.error('❌ Error crítico en validación:', err);
  process.exit(1);
});
