import { db } from '@/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

async function run() {
  console.log('🔍 Buscando asientos en Suspense (9999) para clasificar...');

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

  const SUSPENSE_CODE = '9999';
  const MAPPINGS_PATH = join(process.cwd(), 'rules/suspense-mappings.json');

  // 2. Cargar mapeos manuales
  type SuspenseMapping = Record<string, { glAccountCode: string; description?: string }>;
  let mappings: SuspenseMapping = {};
  try {
    mappings = JSON.parse(readFileSync(MAPPINGS_PATH, 'utf-8'));
    console.log(`📖 Cargadas ${Object.keys(mappings).length} reglas manuales desde ${MAPPINGS_PATH}`);
  } catch {
    console.log('⚠️ No se encontró rules/suspense-mappings.json o está mal formateado.');
  }

  // 3. Obtener borradores en Suspense
  const drafts = await db.journalEntry.findMany({
    where: {
      companyId: companyId,
      status: 'draft',
      lines: { some: { glAccount: { code: SUSPENSE_CODE } } }
    },
    include: {
      lines: { include: { glAccount: true } }
    }
  });

  if (drafts.length === 0) {
    console.log('✅ No hay borradores en Suspense pendientes.');
    return;
  }

  console.log(`📋 Encontrados ${drafts.length} asientos para clasificar:`);
  drafts.forEach((d, i) => {
    const line = d.lines.find(l => l.glAccount.code === SUSPENSE_CODE);
    if (!line) return;
    const amount = line.debit > 0 ? line.debit : -line.credit;
    console.log(`   ${i+1}. "${d.description}" | $${Math.abs(amount).toFixed(2)} | Ref: ${d.reference}`);
  });

  let classified = 0;
  let errors = 0;

  await db.$transaction(async (tx) => {
    for (const entry of drafts) {
      try {
        const line = entry.lines.find(l => l.glAccount.code === SUSPENSE_CODE);
        if (!line) continue;

        // Buscar mapeo por descripción (coincidencia parcial, case-insensitive)
        let targetCode: string | undefined;
        let newDesc: string | undefined;

        for (const [pattern, mapping] of Object.entries(mappings)) {
          if (entry.description?.toLowerCase().includes(pattern.toLowerCase())) {
            targetCode = mapping.glAccountCode;
            newDesc = mapping.description || entry.description;
            break;
          }
        }

        // Si no hay mapeo, mantener en Suspense y saltar
        if (!targetCode) {
          console.log(`⚠️ Sin regla para: "${entry.description}". Permanece en Suspense.`);
          continue;
        }

        // Obtener cuenta destino
        const targetAccount = await tx.glAccount.findFirst({
          where: { companyId: companyId, code: targetCode, isActive: true }
        });
        if (!targetAccount) {
          console.error(`❌ Cuenta "${targetCode}" no encontrada para "${entry.description}"`);
          errors++;
          continue;
        }

        // Actualizar línea con cuenta real
        await tx.journalLine.update({
          where: { id: line.id },
          data: {
            glAccountId: targetAccount.id,
            description: newDesc || entry.description
          }
        });

        // Postear el asiento
        await tx.journalEntry.update({
          where: { id: entry.id },
          data: { status: 'posted', updatedAt: new Date() }
        });

        // Si hay transacción bancaria vinculada, marcar como conciliada
        const bankTx = await tx.bankTransaction.findFirst({
          where: { journalLineId: { in: entry.lines.map(l => l.id) } }
        });

        if (bankTx) {
          await tx.bankTransaction.update({
            where: { id: bankTx.id },
            data: { isReconciled: true, reconciledAt: new Date() }
          });
        }

        classified++;
        console.log(`✅ Clasificado: "${entry.description}" → ${targetAccount.code}`);

      } catch (err) {
        console.error(`❌ Error procesando ${entry.id}: ${(err as Error).message}`);
        errors++;
      }
    }

    // Auditoría del lote
    await tx.auditLog.create({
      data: {
        companyId: companyId,
        action: 'SUSPENSE_DRAFTS_CLASSIFIED',
        entity: 'JournalEntry',
        details: JSON.stringify({ classified, errors, timestamp: new Date().toISOString() })
      }
    });
  });

  console.log(`\n📊 Resumen:`);
  console.log(`   ✅ Clasificados y posteados: ${classified}`);
  console.log(`   ⚠️ Errores/Sin regla: ${errors}`);
  console.log(`   📝 Los no clasificados permanecen en 'draft' para revisión manual.`);
}

run().catch(console.error);
