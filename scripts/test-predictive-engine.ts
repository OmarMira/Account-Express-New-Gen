import { generateSuggestions } from '../src/lib/reconciliation/predictive-engine';
import { db } from '../src/lib/db';

async function runTest() {
  console.log('🤖 Iniciando prueba de Predictive Engine...\n');

  const uniqueId = Math.random().toString(36).substring(7);
  const companyName = `Test Company ${uniqueId}`;
  
  // 1. Create Company
  const company = await db.company.create({
    data: {
      legalName: companyName,
      taxId: '12-3456789',
    },
  });
  console.log(`🏢 Compañía temporal creada: ${company.id}`);

  // 2. Create GL Account
  const glAccount = await db.glAccount.create({
    data: {
      companyId: company.id,
      code: `1010-${uniqueId}`,
      name: `Cash Account ${uniqueId}`,
      accountType: 'asset',
      normalBalance: 'debit',
    },
  });
  console.log(`📔 Cuenta contable temporal creada: ${glAccount.id}`);

  // 3. Create Bank Account
  const bankAccount = await db.bankAccount.create({
    data: {
      companyId: company.id,
      accountName: `Bank Acc ${uniqueId}`,
      bankName: `Bank ${uniqueId}`,
      accountNo: `ACC-${uniqueId}`,
      glAccountId: glAccount.id,
    },
  });
  console.log(`🏦 Cuenta bancaria temporal creada: ${bankAccount.id}`);

  // 4. Create Bank Statement
  const startDate = new Date('2025-05-01T00:00:00Z');
  const endDate = new Date('2025-05-31T23:59:59Z');
  const statement = await db.bankStatement.create({
    data: {
      companyId: company.id,
      bankAccountId: bankAccount.id,
      startDate,
      endDate,
      openingBalance: 1000,
      closingBalance: 1100,
      format: 'csv',
    },
  });
  console.log(`📄 Extracto bancario temporal creado: ${statement.id}`);

  // 5. Create Bank Transaction (unreconciled)
  const txDate = new Date('2025-05-15T12:00:00Z');
  const amount = 150.00;
  const description = `Pago Proveedor XYZ ${uniqueId}`;
  const bankTransaction = await db.bankTransaction.create({
    data: {
      statementId: statement.id,
      date: txDate,
      description,
      amount,
      isReconciled: false,
    },
  });
  console.log(`💸 Transacción bancaria temporal creada: ${bankTransaction.id}`);

  // 6. Create Journal Entry (posted with lines)
  const journalEntry = await db.journalEntry.create({
    data: {
      companyId: company.id,
      date: txDate,
      description,
      status: 'posted',
      lines: {
        create: [
          {
            glAccountId: glAccount.id,
            debit: amount,
            credit: 0,
            description: `Línea débito ${uniqueId}`,
          },
          {
            glAccountId: glAccount.id,
            debit: 0,
            credit: amount,
            description: `Línea crédito ${uniqueId}`,
          }
        ]
      }
    },
    include: {
      lines: true
    }
  });
  console.log(`✍️ Asiento contable temporal creado: ${journalEntry.id}`);

  let cleanupDone = false;
  const cleanup = async () => {
    if (cleanupDone) return;
    console.log('🧹 Limpiando registros temporales de la base de datos...');
    try {
      await db.bankTransaction.deleteMany({ where: { statementId: statement.id } });
      await db.bankStatement.delete({ where: { id: statement.id } });
      await db.journalLine.deleteMany({ where: { entryId: journalEntry.id } });
      await db.journalEntry.delete({ where: { id: journalEntry.id } });
      await db.bankAccount.delete({ where: { id: bankAccount.id } });
      await db.glAccount.delete({ where: { id: glAccount.id } });
      await db.company.delete({ where: { id: company.id } });
      console.log('✅ Base de datos limpia.');
    } catch (err) {
      console.error('⚠️ Error al limpiar base de datos:', err);
    }
    cleanupDone = true;
  };

  try {
    // 7. Invoke generateSuggestions
    console.log('⚙️ Generando sugerencias predictivas...');
    const suggestions = await generateSuggestions(company.id, bankAccount.id);

    console.log(`📊 Sugerencias generadas: ${suggestions.length}`);
    console.log(JSON.stringify(suggestions, null, 2));

    // 8. Assertions
    if (suggestions.length === 0) {
      throw new Error('No se generaron sugerencias.');
    }

    const match = suggestions.find(s => s.bankTxId === bankTransaction.id && s.journalEntryId === journalEntry.id);
    if (!match) {
      throw new Error('No se encontró la sugerencia esperada que vincule la transacción con el asiento.');
    }

    console.log(`✅ Sugerencia encontrada con confianza: ${match.confidence}`);
    console.log(`✅ Razón: ${match.reason}`);

    if (match.confidence < 0.85) {
      throw new Error(`La confianza ${match.confidence} es inferior al umbral mínimo de 0.85`);
    }

    if (!match.reason.includes('monto_exacto')) {
      throw new Error(`La razón esperada 'monto_exacto' no está presente: ${match.reason}`);
    }

    console.log('\n🌟 PRUEBA DE ENGINE PREDICTIVO COMPLETADA CON ÉXITO!\n');
    await cleanup();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR en la prueba de Engine Predictivo:', error);
    await cleanup();
    process.exit(1);
  }
}

runTest().catch(async (err) => {
  console.error('Fallo no controlado:', err);
  process.exit(1);
});
