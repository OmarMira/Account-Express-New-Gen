import { db } from '@/lib/db';

async function run() {
  console.log('🔍 Iniciando verificación de integridad de saldos...');

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

  // 2. Resolver BANK_ACCOUNT_ID dinámicamente
  let bankAccountId = process.env.BANK_ACCOUNT_ID || '';
  if (!bankAccountId) {
    const firstBankAccount = await db.bankAccount.findFirst({
      where: { companyId: companyId, isActive: true }
    });
    if (!firstBankAccount) {
      throw new Error(`No se encontró ninguna cuenta bancaria activa para la compañía con ID: ${companyId}`);
    }
    bankAccountId = firstBankAccount.id;
    console.log(`- BANK_ACCOUNT_ID no provisto. Usando primera cuenta encontrada: "${firstBankAccount.accountName}" (ID: ${bankAccountId})`);
  } else {
    console.log(`- Usando BANK_ACCOUNT_ID provisto: ${bankAccountId}`);
  }

  // 3. Obtener saldo final del último Estado de Cuenta importado (La "Verdad del Banco")
  const latestStatement = await db.bankStatement.findFirst({
    where: { bankAccountId: bankAccountId },
    orderBy: { endDate: 'desc' },
    select: { closingBalance: true, endDate: true }
  });

  if (!latestStatement) {
    console.error('❌ No se encontraron estados de cuenta para esta cuenta bancaria.');
    return;
  }

  // 4. Obtener la cuenta bancaria y su cuenta GL asociada
  const bankAccount = await db.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: { glAccountId: true, accountName: true }
  });

  if (!bankAccount) {
    console.error('❌ Cuenta bancaria no encontrada.');
    return;
  }

  // Cálculo preciso del Libro Mayor (Suma de asientos posteados)
  const journalLines = await db.journalLine.findMany({
    where: {
      glAccountId: bankAccount.glAccountId,
      entry: { companyId: companyId, status: 'posted' }
    },
    select: { debit: true, credit: true }
  });

  let bookBalance = 0;
  for (const line of journalLines) {
    bookBalance += (line.debit || 0) - (line.credit || 0);
  }

  console.log(`\n📊 REPORTE DE SALDOS AL ${new Date(latestStatement.endDate).toLocaleDateString()}:`);
  console.log(`   🏦 Cuenta Bancaria:           ${bankAccount.accountName}`);
  console.log(`   🏦 Saldo Banco (PDF/Estado):  $${latestStatement.closingBalance.toFixed(2)}`);
  console.log(`   📚 Saldo Libros (GL Cuenta):  $${bookBalance.toFixed(2)}`);
  
  const diff = Math.abs(latestStatement.closingBalance - bookBalance);
  
  if (diff < 0.01) {
    console.log('\n✅ SALDOS CUADRAN PERFECTAMENTE. Integridad financiera validada.');
    console.log('👉 Puedes proceder a clasificar manualmente las 8 excepciones.');
  } else {
    console.log(`\n⚠️ DIFERENCIA DETECTADA: $${diff.toFixed(2)}`);
    console.log('🛑 DETENER. Hay transacciones clasificadas incorrectamente o falta un asiento de apertura.');
  }
}

run().catch(console.error);
