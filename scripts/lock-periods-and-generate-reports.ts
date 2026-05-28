import { db } from '@/lib/db';

async function run() {
  console.log('🔄 Iniciando bloqueo de períodos y generación de reportes financieros...');

  // 1. Resolver COMPANY_ID dinámicamente
  let companyId = process.env.COMPANY_ID || '';
  if (!companyId) {
    const firstCompany = await db.company.findFirst();
    if (!firstCompany) {
      throw new Error('No se encontró ninguna compañía en la base de datos.');
    }
    companyId = firstCompany.id;
    console.log(`- COMPANY_ID no provisto. Usando primera compañía encontrada: "${firstCompany.legalName}" (ID: ${companyId})`);
  } else {
    console.log(`- Usando COMPANY_ID provisto: ${companyId}`);
  }

  // 2. Crear y bloquear los períodos fiscales de Ene-May 2025
  console.log('\n🔒 Bloqueando períodos fiscales Ene-May 2025...');
  const months = [
    { name: 'ENERO 2025', start: '2025-01-01', end: '2025-01-31' },
    { name: 'FEBRERO 2025', start: '2025-02-01', end: '2025-02-28' },
    { name: 'MARZO 2025', start: '2025-03-01', end: '2025-03-31' },
    { name: 'ABRIL 2025', start: '2025-04-01', end: '2025-04-30' },
    { name: 'MAYO 2025', start: '2025-05-01', end: '2025-05-31' }
  ];

  await db.$transaction(async (tx) => {
    for (const m of months) {
      const existing = await tx.fiscalPeriod.findUnique({
        where: {
          companyId_name: {
            companyId: companyId,
            name: m.name
          }
        }
      });

      if (existing) {
        await tx.fiscalPeriod.update({
          where: { id: existing.id },
          data: { isLocked: true }
        });
        console.log(`   🔒 Período "${m.name}" actualizado a BLOQUEADO.`);
      } else {
        await tx.fiscalPeriod.create({
          data: {
            companyId: companyId,
            name: m.name,
            startDate: new Date(m.start + 'T00:00:00.000Z'),
            endDate: new Date(m.end + 'T23:59:59.999Z'),
            isLocked: true
          }
        });
        console.log(`   🔒 Período "${m.name}" creado y BLOQUEADO.`);
      }
    }

    // Auditoría
    await tx.auditLog.create({
      data: {
        companyId: companyId,
        action: 'FISCAL_PERIODS_LOCKED',
        entity: 'FiscalPeriod',
        details: JSON.stringify({ periods: months.map(m => m.name), timestamp: new Date().toISOString() })
      }
    });
  });

  // 3. Generación de Reportes Financieros al 31/05/2025
  const asOfDate = new Date('2025-05-31T23:59:59.999Z');
  console.log(`\n📊 Generando reportes financieros con fecha de corte al ${asOfDate.toLocaleDateString()}...`);

  // Obtener todas las líneas de asientos contables posteados
  const journalLines = await db.journalLine.findMany({
    where: {
      entry: {
        companyId: companyId,
        status: 'posted',
        date: { lte: asOfDate }
      }
    },
    include: {
      glAccount: true
    }
  });

  // Consolidar saldos por cuenta contable
  const accountBalances = new Map<string, {
    code: string;
    name: string;
    accountType: string;
    debitTotal: number;
    creditTotal: number;
    normalBalance: string;
  }>();

  for (const line of journalLines) {
    const acc = line.glAccount;
    if (!acc || !acc.isActive) continue;
    const key = acc.code;
    if (!accountBalances.has(key)) {
      accountBalances.set(key, {
        code: acc.code,
        name: acc.name,
        accountType: acc.accountType,
        debitTotal: 0,
        creditTotal: 0,
        normalBalance: acc.normalBalance
      });
    }
    const entry = accountBalances.get(key)!;
    entry.debitTotal += line.debit || 0;
    entry.creditTotal += line.credit || 0;
  }

  // Listar balances consolidados y calcular totales
  const accountsList: {
    code: string;
    name: string;
    accountType: string;
    debit: number;
    credit: number;
    balance: number;
    normalBalance: string;
  }[] = [];

  let totalDebits = 0;
  let totalCredits = 0;

  for (const entry of accountBalances.values()) {
    const netBalance = entry.normalBalance === 'debit'
      ? entry.debitTotal - entry.creditTotal
      : entry.creditTotal - entry.debitTotal;

    accountsList.push({
      code: entry.code,
      name: entry.name,
      accountType: entry.accountType,
      debit: entry.debitTotal,
      credit: entry.creditTotal,
      balance: netBalance,
      normalBalance: entry.normalBalance
    });

    totalDebits += entry.debitTotal;
    totalCredits += entry.creditTotal;
  }

  // Ordenar cuentas por código
  accountsList.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // --- REPORT 1: TRIAL BALANCE ---
  console.log('\n======================================================================');
  console.log('                   BALANZA DE COMPROBACIÓN (TRIAL BALANCE)');
  console.log(`                   Al ${asOfDate.toLocaleDateString()}`);
  console.log('======================================================================');
  console.log(String('Código').padEnd(8) + ' | ' + String('Nombre de la Cuenta').padEnd(35) + ' | ' + String('Débito').padStart(12) + ' | ' + String('Crédito').padStart(12));
  console.log('-'.repeat(74));

  for (const acc of accountsList) {
    if (Math.abs(acc.debit) < 0.01 && Math.abs(acc.credit) < 0.01) continue;
    
    // Mostramos los totales acumulados de débito y crédito
    console.log(
      acc.code.padEnd(8) + ' | ' +
      acc.name.substring(0, 35).padEnd(35) + ' | ' +
      acc.debit.toFixed(2).padStart(12) + ' | ' +
      acc.credit.toFixed(2).padStart(12)
    );
  }
  console.log('-'.repeat(74));
  console.log(String('TOTALES').padEnd(46) + ' | ' + totalDebits.toFixed(2).padStart(12) + ' | ' + totalCredits.toFixed(2).padStart(12));
  console.log('======================================================================');
  
  const trialDiff = Math.abs(totalDebits - totalCredits);
  if (trialDiff < 0.01) {
    console.log('✅ BALANZA TOTALMENTE CUADRADA: Débitos = Créditos.');
  } else {
    console.log(`⚠️ BALANZA DESCUADRADA POR: $${trialDiff.toFixed(2)}`);
  }

  // --- REPORT 2: INCOME STATEMENT (ESTADO DE RESULTADOS) ---
  console.log('\n======================================================================');
  console.log('                   ESTADO DE RESULTADOS (INCOME STATEMENT)');
  console.log(`               Desde 2025-01-01 Hasta ${asOfDate.toLocaleDateString()}`);
  console.log('======================================================================');

  const revenueAccounts = accountsList.filter(a => a.accountType === 'revenue');
  const expenseAccounts = accountsList.filter(a => a.accountType === 'expense');

  let totalRevenue = 0;
  console.log('INGRESOS:');
  for (const r of revenueAccounts) {
    const val = r.balance;
    console.log(`   ${r.code} - ${r.name.padEnd(40)} $${val.toFixed(2).padStart(12)}`);
    totalRevenue += val;
  }
  console.log(`TOTAL INGRESOS:'.padEnd(50)} $${totalRevenue.toFixed(2).padStart(12)}`);
  console.log('-'.repeat(74));

  let totalExpenses = 0;
  console.log('EGRESOS / GASTOS:');
  for (const e of expenseAccounts) {
    const val = e.balance;
    console.log(`   ${e.code} - ${e.name.padEnd(40)} $${val.toFixed(2).padStart(12)}`);
    totalExpenses += val;
  }
  console.log(`TOTAL GASTOS:'.padEnd(50)} $${totalExpenses.toFixed(2).padStart(12)}`);
  console.log('-'.repeat(74));

  const netIncome = totalRevenue - totalExpenses;
  console.log(`UTILIDAD NETO DEL EJERCICIO:'.padEnd(50)} $${netIncome.toFixed(2).padStart(12)}`);
  console.log('======================================================================');

  // --- REPORT 3: BALANCE SHEET (BALANCE GENERAL) ---
  console.log('\n======================================================================');
  console.log('                   BALANCE GENERAL (BALANCE SHEET)');
  console.log(`                   Al ${asOfDate.toLocaleDateString()}`);
  console.log('======================================================================');

  const assetAccounts = accountsList.filter(a => a.accountType === 'asset');
  const liabilityAccounts = accountsList.filter(a => a.accountType === 'liability');
  const equityAccounts = accountsList.filter(a => a.accountType === 'equity');

  let totalAssets = 0;
  console.log('ACTIVOS (ASSETS):');
  for (const a of assetAccounts) {
    const val = a.balance;
    console.log(`   ${a.code} - ${a.name.padEnd(40)} $${val.toFixed(2).padStart(12)}`);
    totalAssets += val;
  }
  console.log(`TOTAL ACTIVOS:'.padEnd(50)} $${totalAssets.toFixed(2).padStart(12)}`);
  console.log('-'.repeat(74));

  let totalLiabilities = 0;
  console.log('PASIVOS (LIABILITIES):');
  for (const l of liabilityAccounts) {
    const val = l.balance;
    console.log(`   ${l.code} - ${l.name.padEnd(40)} $${val.toFixed(2).padStart(12)}`);
    totalLiabilities += val;
  }
  console.log(`TOTAL PASIVOS:'.padEnd(50)} $${totalLiabilities.toFixed(2).padStart(12)}`);
  console.log('-'.repeat(74));

  let totalEquity = 0;
  console.log('PATRIMONIO (EQUITY):');
  for (const eq of equityAccounts) {
    const val = eq.balance;
    console.log(`   ${eq.code} - ${eq.name.padEnd(40)} $${val.toFixed(2).padStart(12)}`);
    totalEquity += val;
  }
  
  // Agregar utilidad neta del año actual al patrimonio (Current Year Earnings)
  console.log(`   3030 - Utilidad del Ejercicio (P&L Net Income)  $${netIncome.toFixed(2).padStart(12)}`);
  totalEquity += netIncome;

  console.log(`TOTAL PATRIMONIO:'.padEnd(50)} $${totalEquity.toFixed(2).padStart(12)}`);
  console.log('-'.repeat(74));

  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  console.log(`TOTAL PASIVO + PATRIMONIO:'.padEnd(50)} $${totalLiabilitiesAndEquity.toFixed(2).padStart(12)}`);
  console.log('======================================================================');

  const equationDiff = Math.abs(totalAssets - totalLiabilitiesAndEquity);
  if (equationDiff < 0.01) {
    console.log('✅ ECUACIÓN CONTABLE INTEGRADA: Activo = Pasivo + Patrimonio.');
  } else {
    console.log(`⚠️ DESCUADRE DE LA ECUACIÓN: $${equationDiff.toFixed(2)}`);
  }
}

run().catch(console.error);
