import { db } from '@/lib/db';

async function run() {
  console.log('📝 Creando asiento de apertura...');

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

  const OPENING_BALANCE = 32615.55; // Saldo inicial según eStmt_2025-01-31.pdf
  const EQUITY_ACCOUNT_CODE = '3010'; // Owner's Equity (ajustar si usas otra)

  // 3. Obtener la cuenta bancaria y su GL vinculado
  const bankAccount = await db.bankAccount.findUnique({
    where: { id: bankAccountId, companyId: companyId },
    include: { glAccount: true }
  });
  if (!bankAccount || !bankAccount.glAccount) {
    throw new Error('Cuenta bancaria no encontrada o sin cuenta GL vinculada');
  }

  // 4. Obtener cuenta de patrimonio para contrapartida
  let equityAccount = await db.glAccount.findFirst({
    where: { companyId: companyId, code: EQUITY_ACCOUNT_CODE, isActive: true }
  });
  if (!equityAccount) {
    equityAccount = await db.glAccount.findFirst({
      where: { companyId: companyId, accountType: 'equity', isActive: true }
    });
    if (!equityAccount) {
      throw new Error(`Cuenta de patrimonio no encontrada`);
    }
    console.log(`- Cuenta de patrimonio no encontrada con código "${EQUITY_ACCOUNT_CODE}". Usando "${equityAccount.code} ${equityAccount.name}" (ID: ${equityAccount.id})`);
  }

  // 5. Validar que no exista ya un asiento de apertura
  const existing = await db.journalEntry.findFirst({
    where: {
      companyId: companyId,
      reference: 'OPENING-BALANCE',
      status: 'posted'
    }
  });
  if (existing) {
    console.log('⚠️ Asiento de apertura ya existe. Saltando creación.');
    return;
  }

  // 6. Crear asiento balanceado (Débito a Banco, Crédito a Patrimonio)
  const entry = await db.$transaction(async (tx) => {
    const newEntry = await tx.journalEntry.create({
      data: {
        companyId: companyId,
        date: new Date('2025-01-01T00:00:00.000Z'), // Fecha de inicio del primer período
        description: 'Saldo inicial de cuenta bancaria - Apertura de ejercicio',
        reference: 'OPENING-BALANCE',
        status: 'posted', // Se postea directamente porque es saldo histórico
        lines: {
          create: [
            {
              // Débito a la cuenta bancaria (Activo aumenta con débito)
              glAccountId: bankAccount.glAccountId,
              description: 'Saldo inicial bancario según estado de cuenta',
              debit: OPENING_BALANCE,
              credit: 0
            },
            {
              // Crédito a patrimonio (Equity aumenta con crédito)
              glAccountId: equityAccount.id,
              description: 'Contrapartida de apertura - Capital inicial',
              debit: 0,
              credit: OPENING_BALANCE
            }
          ]
        }
      }
    });

    // Actualizar el saldo cacheado de la cuenta bancaria
    await tx.bankAccount.update({
      where: { id: bankAccountId },
      data: { balance: OPENING_BALANCE }
    });

    // Auditoría
    await tx.auditLog.create({
      data: {
        companyId: companyId,
        action: 'OPENING_BALANCE_POSTED',
        entity: 'JournalEntry',
        entityId: newEntry.id,
        details: JSON.stringify({ amount: OPENING_BALANCE, bankAccount: bankAccount.accountName, equityAccount: equityAccount.code })
      }
    });

    return newEntry;
  });

  console.log(`✅ Asiento de apertura creado exitosamente:`);
  console.log(`   📅 Fecha: 2025-01-01`);
  console.log(`   💰 Monto: $${OPENING_BALANCE.toFixed(2)}`);
  console.log(`   🔗 Entry ID: ${entry.id}`);
  console.log(`\n🔍 Ahora ejecuta nuevamente verify-balances.ts para confirmar el cuadre.`);
}

run().catch(err => {
  console.error('❌ Error creando asiento de apertura:', err);
  process.exit(1);
});
