import { getVarianceReport } from '../src/lib/budget/engine';
import { db } from '../src/lib/db';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

async function runTest() {
  console.log('🤖 Iniciando prueba de Budget Engine (Variance Report)...\n');

  const budgetsPath = join(process.cwd(), 'data/budgets.json');
  let originalBudgetContent: string | null = null;
  if (existsSync(budgetsPath)) {
    originalBudgetContent = readFileSync(budgetsPath, 'utf-8');
    console.log(`💾 Respaldo de presupuestos existente creado (${originalBudgetContent.length} bytes).`);
  }

  const uniqueId = Math.random().toString(36).substring(7);
  const companyName = `Test Budget Company ${uniqueId}`;

  // 1. Create temporary Company
  const company = await db.company.create({
    data: {
      legalName: companyName,
      taxId: '88-8888888',
    },
  });
  console.log(`🏢 Compañía temporal creada: ${company.id}`);

  // 2. Create GL Accounts
  const glAccountRevenue = await db.glAccount.create({
    data: {
      companyId: company.id,
      code: '4010',
      name: 'Revenue Account',
      accountType: 'revenue',
      normalBalance: 'credit',
    },
  });

  const glAccountExpense = await db.glAccount.create({
    data: {
      companyId: company.id,
      code: '5010',
      name: 'Expense Account',
      accountType: 'expense',
      normalBalance: 'debit',
    },
  });
  console.log(`📔 Cuentas contables creadas: ${glAccountRevenue.code}, ${glAccountExpense.code}`);

  // 3. Write test budget config to data/budgets.json
  const testBudgetConfig = {
    "2025": {
      "5": {
        "4010": 1000.0,
        "5010": 1000.0
      }
    }
  };
  writeFileSync(budgetsPath, JSON.stringify(testBudgetConfig, null, 2), 'utf-8');
  console.log('📝 Archivo data/budgets.json temporal escrito.');

  let journalEntryId: string | null = null;

  const cleanup = async () => {
    console.log('🧹 Iniciando limpieza...');
    // Restore budgets.json
    try {
      if (originalBudgetContent !== null) {
        writeFileSync(budgetsPath, originalBudgetContent, 'utf-8');
        console.log('✅ Archivo data/budgets.json restaurado.');
      } else {
        writeFileSync(budgetsPath, '{}', 'utf-8');
        console.log('✅ Archivo data/budgets.json limpiado.');
      }
    } catch (e) {
      console.error('⚠️ Error al restaurar data/budgets.json:', e);
    }

    // Cleanup DB
    try {
      if (journalEntryId) {
        await db.journalLine.deleteMany({ where: { entryId: journalEntryId } }).catch(() => {});
        await db.journalEntry.delete({ where: { id: journalEntryId } }).catch(() => {});
      }
      await db.glAccount.deleteMany({ where: { companyId: company.id } });
      await db.company.delete({ where: { id: company.id } });
      console.log('✅ Registros de base de datos temporales eliminados.');
    } catch (e) {
      console.error('⚠️ Error al eliminar registros de base de datos:', e);
    }
  };

  try {
    // 4. Create posted Journal Entry and lines for May 2025
    const entryDate = new Date('2025-05-15T12:00:00Z');
    const journalEntry = await db.journalEntry.create({
      data: {
        companyId: company.id,
        date: entryDate,
        description: 'Test Journal Entry for Budget',
        status: 'posted',
        lines: {
          create: [
            {
              glAccountId: glAccountRevenue.id,
              debit: 0,
              credit: 1500.0,
              description: 'Revenue line',
            },
            {
              glAccountId: glAccountExpense.id,
              debit: 1200.0,
              credit: 0,
              description: 'Expense line',
            }
          ]
        }
      }
    });
    journalEntryId = journalEntry.id;
    console.log(`✍️ Asiento contable posteado temporal creado: ${journalEntry.id}`);

    // 5. Invoke getVarianceReport
    console.log('⚙️ Generando reporte de varianza de presupuesto...');
    const report = await getVarianceReport(company.id, 2025, 5);

    console.log(`📊 Reporte generado: ${report.length} cuentas`);
    console.log(JSON.stringify(report, null, 2));

    // 6. Assertions
    if (report.length !== 2) {
      throw new Error(`Se esperaban 2 cuentas en el reporte, se obtuvieron ${report.length}`);
    }

    const revenueReport = report.find(r => r.accountCode === '4010');
    if (!revenueReport) {
      throw new Error('Falta la cuenta de ingresos 4010 en el reporte');
    }
    // Revenue account: credit balance. Budget: 1000, Actual: 1500 (credit - debit = 1500 - 0 = 1500). Variance: 500. VariancePercent: 50%. Status: CRITICAL.
    if (revenueReport.budget !== 1000 || revenueReport.actual !== 1500 || revenueReport.variance !== 500 || revenueReport.variancePercent !== 50 || revenueReport.status !== 'CRITICAL') {
      throw new Error(`Datos incorrectos para la cuenta de ingresos 4010: ${JSON.stringify(revenueReport)}`);
    }

    const expenseReport = report.find(r => r.accountCode === '5010');
    if (!expenseReport) {
      throw new Error('Falta la cuenta de gastos 5010 en el reporte');
    }
    // Expense account: debit balance. Budget: 1000, Actual: 1200 (debit - credit = 1200 - 0 = 1200). Variance: 200. VariancePercent: 20%. Status: WARNING.
    if (expenseReport.budget !== 1000 || expenseReport.actual !== 1200 || expenseReport.variance !== 200 || expenseReport.variancePercent !== 20 || expenseReport.status !== 'WARNING') {
      throw new Error(`Datos incorrectos para la cuenta de gastos 5010: ${JSON.stringify(expenseReport)}`);
    }

    console.log('\n🌟 PRUEBA DE BUDGET ENGINE COMPLETADA CON ÉXITO!\n');
    await cleanup();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR en la prueba de Budget Engine:', error);
    await cleanup();
    process.exit(1);
  }
}

runTest().catch(async (err) => {
  console.error('Fallo no controlado:', err);
  process.exit(1);
});
