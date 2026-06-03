import { recordFeedback, generateCandidateRules } from '../src/lib/learning/adaptive-engine';
import { db } from '../src/lib/db';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

async function runTest() {
  console.log('🤖 Iniciando prueba de Learning Loop (Adaptive Engine)...\n');

  // Load config to find the log file path and backing it up
  const configPath = join(process.cwd(), 'rules/learning-engine.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const logPath = join(process.cwd(), config.feedbackLogPath);

  let originalLogContent: string | null = null;
  if (existsSync(logPath)) {
    originalLogContent = readFileSync(logPath, 'utf-8');
    console.log(`💾 Respaldo de log existente creado (${originalLogContent.length} bytes).`);
  } else {
    console.log('💾 No existe log previo. Se creará uno nuevo.');
  }

  const uniqueId = Math.random().toString(36).substring(7);
  const companyName = `Test Learning Company ${uniqueId}`;

  // Create temporary Company
  const company = await db.company.create({
    data: {
      legalName: companyName,
      taxId: '99-9999999',
    },
  });
  console.log(`🏢 Compañía temporal creada: ${company.id}`);

  const cleanup = async () => {
    console.log('🧹 Iniciando limpieza...');
    // 1. Restore log file
    try {
      if (originalLogContent !== null) {
        writeFileSync(logPath, originalLogContent, 'utf-8');
        console.log('✅ Archivo de log restaurado.');
      } else if (existsSync(logPath)) {
        writeFileSync(logPath, '', 'utf-8'); // clear it
        console.log('✅ Archivo de log temporal limpiado.');
      }
    } catch (e) {
      console.error('⚠️ Error al limpiar el log:', e);
    }

    // 2. Cleanup Company
    try {
      await db.company.delete({ where: { id: company.id } });
      console.log('✅ Compañía temporal eliminada de la base de datos.');
    } catch (e) {
      console.error('⚠️ Error al eliminar compañía:', e);
    }
  };

  try {
    // Record feedback multiple times for the same pattern
    const pattern = 'Aba Zelle Test';
    const glAccountCode = `4010-${uniqueId}`;
    console.log(`✍️ Registrando feedback 5 veces para el patrón: "${pattern}" -> Cuenta: "${glAccountCode}"`);

    for (let i = 0; i < 5; i++) {
      await recordFeedback({
        timestamp: new Date().toISOString(),
        bankDescription: pattern,
        selectedGlAccountCode: glAccountCode,
        confidence: 0.95,
        userId: 'test-user',
        companyId: company.id,
        amount: -50.00, // Debit transaction
      });
    }

    console.log('⚙️ Ejecutando generación de reglas candidatas...');
    const candidates = await generateCandidateRules(company.id);

    console.log(`📊 Reglas candidatas generadas: ${candidates.length}`);
    console.log(JSON.stringify(candidates, null, 2));

    if (candidates.length === 0) {
      throw new Error('No se generaron reglas candidatas.');
    }

    const candidate = candidates[0];

    // Assert correct fields
    const requiredFields = ['id', 'pattern', 'glAccountCode', 'occurrences', 'direction', 'status'];
    for (const field of requiredFields) {
      if (candidate[field] === undefined) {
        throw new Error(`Falta el campo requerido '${field}' en la regla generada.`);
      }
    }

    // Assert exact values
    if (candidate.glAccountCode !== glAccountCode) {
      throw new Error(`Cuenta GL esperada: ${glAccountCode}, recibida: ${candidate.glAccountCode}`);
    }

    if (candidate.occurrences !== 5) {
      throw new Error(`Ocurrencias esperadas: 5, recibidas: ${candidate.occurrences}`);
    }

    if (candidate.direction !== 'debit') {
      throw new Error(`Dirección esperada: 'debit', recibida: ${candidate.direction}`);
    }

    if (candidate.status !== 'pending_review') {
      throw new Error(`Estado esperado: 'pending_review', recibido: ${candidate.status}`);
    }

    console.log('\n🌟 PRUEBA DE LEARNING LOOP COMPLETADA CON ÉXITO!\n');
    await cleanup();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR en la prueba de Learning Loop:', error);
    await cleanup();
    process.exit(1);
  }
}

runTest().catch(async (err) => {
  console.error('Fallo no controlado:', err);
  process.exit(1);
});
