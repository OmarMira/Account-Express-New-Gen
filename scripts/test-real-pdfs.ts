import fs from 'fs';
import path from 'path';
import { parsePDF } from '../src/lib/pdf-parser';
import { db } from '../src/lib/db';
import { invalidateAllProfilesCache } from '../src/lib/bank-profile-service';
import boaProfile from '../src/lib/bank-profiles/boa-standard.json';
import { BankProfileConfigSchema } from '../src/lib/bank-profile-schema';

async function main() {
  console.log('🚀 Iniciando validación de PDFs reales de Bank of America con parser v5.1...');

  const fixturesDir = path.join(process.cwd(), 'tests/fixtures/boa-statements');
  if (!fs.existsSync(fixturesDir)) {
    console.error(`❌ El directorio de fixtures no existe: ${fixturesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(fixturesDir)
    .filter(file => file.endsWith('.pdf'))
    .sort();

  if (files.length === 0) {
    console.warn('⚠️ No se encontraron archivos PDF en el directorio.');
    process.exit(0);
  }

  // Limpiar perfiles autogenerados anteriores para simular onboarding desde cero
  const deleteResult = await db.bankProfile.deleteMany({
    where: { bankId: { startsWith: 'auto-' } }
  });
  console.log(`🧹 Limpiados ${deleteResult.count} perfiles autogenerados anteriores de la base de datos.`);

  // Invalidar caché de perfiles antes de arrancar
  invalidateAllProfilesCache();

  // Sincronizar el perfil boa-standard con la BD
  const validation = BankProfileConfigSchema.safeParse({
    layoutType: boaProfile.layoutType,
    lineGroupingTolerancePx: boaProfile.lineGroupingTolerancePx,
    numberFormat: boaProfile.numberFormat,
    rules: boaProfile.rules,
  });
  if (validation.success) {
    await db.bankProfile.upsert({
      where: { bankId: boaProfile.bankId },
      create: {
        bankId: boaProfile.bankId,
        bankName: boaProfile.bankName,
        fingerprints: JSON.stringify(boaProfile.fingerprints),
        config: JSON.stringify(validation.data),
        isActive: true,
      },
      update: {
        bankName: boaProfile.bankName,
        fingerprints: JSON.stringify(boaProfile.fingerprints),
        config: JSON.stringify(validation.data),
      },
    });
    console.log('🔄 Sincronizado perfil boa-standard.json con la base de datos.');
  } else {
    console.error('❌ Error al validar boa-standard.json:', validation.error);
  }

  console.log(`\n📂 Se encontraron ${files.length} archivos para procesar.\n`);

  for (const file of files) {
    const filePath = path.join(fixturesDir, file);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`📄 Procesando: ${file}`);
    console.log(`--------------------------------------------------------------------------------`);

    try {
      const buffer = fs.readFileSync(filePath);
      
      const startTime = Date.now();
      const result = await parsePDF(buffer, { fileName: file });
      const duration = Date.now() - startTime;

      console.log(`⏱️ Tiempo de procesamiento: ${duration}ms`);
      console.log(`🏦 Banco: ${result.bankName || 'Desconocido'}`);
      console.log(`👤 Titular: ${result.accountHolder || 'Desconocido'}`);
      console.log(`💳 Cuenta: ${result.accountNo || 'Desconocido'}`);
      console.log(`💰 Saldo Inicial: ${result.openingBalance !== undefined ? `$${result.openingBalance}` : 'No extraído'}`);
      console.log(`💰 Saldo Final: ${result.closingBalance !== undefined ? `$${result.closingBalance}` : 'No extraído'}`);
      console.log(`📊 Transacciones extraídas: ${result.transactions.length}`);
      
      // Mostrar resumen de transacciones si hay
      if (result.transactions.length > 0) {
        console.log('   Primeras 3 transacciones:');
        result.transactions.slice(0, 3).forEach((t, i) => {
          const formattedDate = t.date.toISOString().split('T')[0];
          console.log(`     [${i + 1}] ${formattedDate} | ${t.description.substring(0, 45)} | $${t.amount}`);
        });
      }

      console.log(`\n⚖️ Reconciliación matemática: ${result.mathValid ? '✅ VÁLIDA' : '❌ INCORRECTA'}`);
      if (result.mismatch !== undefined) {
        console.log(`   Diferencia (mismatch): $${result.mismatch}`);
      }

      console.log(`🩹 Self-Healing intentado: ${result.selfHealingAttempted ? 'Sí' : 'No'}`);
      if (result.selfHealingAttempted) {
        console.log(`   Resultado Self-Healing: ${result.selfHealingSuccess ? '✅ EXITOSO' : '❌ FALLIDO'}`);
      }

      if (result.warnings.length > 0) {
        console.log('⚠️ Advertencias:');
        result.warnings.forEach(w => console.log(`   - ${w}`));
      }
      console.log('\n');

    } catch (error) {
      console.error(`❌ Error al parsear el archivo ${file}:`, error);
      console.log('\n');
    }
  }

  console.log('================================================================================');
  console.log('🏁 Proceso finalizado para todos los archivos.');
  console.log('================================================================================');
  
  // Cerrar conexión a la BD para liberar recursos
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error('Fatal error en el script:', e);
  await db.$disconnect();
  process.exit(1);
});
