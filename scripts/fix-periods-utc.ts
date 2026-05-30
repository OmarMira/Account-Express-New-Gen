import { db } from '@/lib/db';

async function run() {
  console.log('🧹 Iniciando saneamiento optimizado de períodos fiscales (UTC)...');

  // 1. Obtener todos los períodos
  const periods = await db.fiscalPeriod.findMany();
  console.log(`- Se encontraron ${periods.length} períodos en la base de datos.`);

  const updatesToApply: { id: string; currentName: string; fullName: string; companyId: string; startDate: Date; endDate: Date }[] = [];

  // Calcular nombres esperados
  for (const period of periods) {
    const expectedName = period.startDate.toLocaleString('es-ES', {
      month: 'long',
      timeZone: 'UTC',
    }).toUpperCase();
    const expectedYear = period.startDate.getUTCFullYear();
    const fullName = `${expectedName} ${expectedYear}`;

    if (period.name !== fullName) {
      updatesToApply.push({
        id: period.id,
        currentName: period.name,
        fullName,
        companyId: period.companyId,
        startDate: period.startDate,
        endDate: period.endDate,
      });
    }
  }

  if (updatesToApply.length === 0) {
    console.log('🎉 Todos los períodos ya están perfectamente alineados en UTC. No se requiere saneamiento.');
    return;
  }

  console.log(`⚠️ Se detectaron ${updatesToApply.length} períodos con discrepancias. Aplicando migración de doble fase...`);

  // FASE 1: Renombrar temporalmente para evitar colisión de restricción única
  console.log('\n--- FASE 1: Aplicando nombres temporales ---');
  for (const update of updatesToApply) {
    const tempName = `TEMP_${update.id.substring(0, 8)}_${update.fullName}`;
    await db.fiscalPeriod.update({
      where: { id: update.id },
      data: { name: tempName },
    });
    console.log(`  - ID ${update.id}: "${update.currentName}" ➡️ "${tempName}"`);
  }

  // FASE 2: Aplicar nombres finales normalizados y registrar logs de auditoría
  console.log('\n--- FASE 2: Aplicando nombres normalizados finales y AuditLog ---');
  let fixCount = 0;
  for (const update of updatesToApply) {
    await db.$transaction(async (tx) => {
      await tx.fiscalPeriod.update({
        where: { id: update.id },
        data: { name: update.fullName },
      });

      // Registrar en AuditLog
      await tx.auditLog.create({
        data: {
          companyId: update.companyId,
          action: 'FISCAL_PERIOD_NAME_NORMALIZED',
          entity: 'FiscalPeriod',
          entityId: update.id,
          details: JSON.stringify({
            oldName: update.currentName,
            newName: update.fullName,
            startDate: update.startDate.toISOString(),
            endDate: update.endDate.toISOString(),
          }),
        },
      });
    });
    console.log(`  - ID ${update.id}: Normalizado exitosamente a "${update.fullName}"`);
    fixCount++;
  }

  console.log(`\n🎉 Saneamiento finalizado con éxito total. Se normalizaron ${fixCount} períodos fiscales desfasados sin colisiones.`);
}

run().catch((err) => {
  console.error('❌ Error ejecutando el saneamiento:', err);
  process.exit(1);
});
