import { db } from '@/lib/db';

async function run() {
  console.log('🔄 Iniciando confirmación de conciliación automática...');

  let companyId = process.env.COMPANY_ID || '';
  if (!companyId) {
    const firstCompany = await db.company.findFirst();
    if (!firstCompany) throw new Error('No se encontró ninguna compañía en la base de datos.');
    companyId = firstCompany.id;
    console.log(`- COMPANY_ID no provisto. Usando primera compañía encontrada: "${firstCompany.legalName}" (ID: ${companyId})`);
  } else {
    console.log(`- Usando COMPANY_ID provisto: ${companyId}`);
  }

  // 1. Buscar transacciones bancarias que:
  //    a) No estén conciliadas aún (isReconciled: false)
  //    b) Tengan un asiento vinculado (journalLineId no es null)
  //    c) Pertenezcan a la compañía (vía statement -> companyId)
  const pendingLinkedTxs = await db.bankTransaction.findMany({
    where: {
      statement: { companyId: companyId },
      isReconciled: false,
      journalLineId: { not: null }
    }
  });

  console.log(`📊 Encontradas ${pendingLinkedTxs.length} transacciones vinculadas pendientes.`);

  let reconciledCount = 0;
  let skippedCount = 0;

  await db.$transaction(async (tx) => {
    for (const bt of pendingLinkedTxs) {
      if (!bt.journalLineId) continue;
      
      // Obtener la línea de asiento contable y su asiento (entry)
      const journalLine = await tx.journalLine.findUnique({
        where: { id: bt.journalLineId },
        include: { entry: true }
      });

      // 2. Validación de seguridad: Solo conciliar si el asiento está POSTEADO
      if (journalLine?.entry?.status === 'posted') {
        await tx.bankTransaction.update({
          where: { id: bt.id },
          data: {
            isReconciled: true,
            reconciledAt: new Date()
          }
        });
        reconciledCount++;
      } else {
        // Si el asiento sigue en "draft" (los 8 de Suspense), saltar
        skippedCount++;
      }
    }

    // 3. Auditoría
    await tx.auditLog.create({
      data: {
        companyId: companyId,
        action: 'AUTO_RECONCILIATION_COMMIT',
        entity: 'BankTransaction',
        details: JSON.stringify({
          matched: reconciledCount,
          skippedDrafts: skippedCount,
          timestamp: new Date().toISOString()
        })
      }
    });
  });

  console.log(`\n✅ Conciliación completada:`);
  console.log(`   🔒 ${reconciledCount} transacciones marcadas como conciliadas (Vinculadas a asientos Posteados).`);
  console.log(`   ⏸️ ${skippedCount} transacciones omitidas (Asociadas a borradores en Suspense).`);
  console.log(`\n🔍 Revisa ahora en Bancos > Conciliación. Los saldos del Libro Mayor deben coincidir con el Banco.`);
}

run().catch(err => {
  console.error('❌ Error en conciliación:', err);
  process.exit(1);
});
