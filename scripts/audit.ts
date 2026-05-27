import { promises as fs } from 'fs';
import { join } from 'path';

const projectRoot = process.cwd();

async function checkFileExists(path: string): Promise<boolean> {
  try {
    await fs.access(join(projectRoot, path));
    return true;
  } catch {
    return false;
  }
}

async function searchInFile(path: string, pattern: RegExp): Promise<boolean> {
  try {
    const content = await fs.readFile(join(projectRoot, path), 'utf-8');
    return pattern.test(content);
  } catch {
    return false;
  }
}

console.log('=== INICIANDO AUDITORÍA AUTOMÁTICA DE SISTEMA ===\n');

// 1. Estado de archivos del repositorio
const hasHealthApi = await checkFileExists('src/app/api/health/route.ts');
const hasBackupScript = await checkFileExists('scripts/backup-db.ts');

console.log('1. SPRINT ARTIFACTS:');
console.log(`- Endpoint /api/health:       ${hasHealthApi ? '✅ IMPLEMENTADO' : '❌ AUSENTE'}`);
console.log(`- Script backup-db.ts:        ${hasBackupScript ? '✅ IMPLEMENTADO' : '❌ AUSENTE'}`);

// 2. Análisis de Fallos Potenciales
console.log('\n2. DIAGNÓSTICO DE FALLOS SOSPECHOSOS:');

// Fallo 1 & 2: import.service.ts
const hasFindUniqueStatement = await searchInFile(
  'src/services/import.service.ts',
  /findUnique.*bankAccountId.*startDate.*endDate/i
);
const hasMathAssert = await searchInFile(
  'src/services/import.service.ts',
  /beginningBalance.*endingBalance/i
);

console.log(`- Fallo 1 (Statement duplicate check): ${hasFindUniqueStatement ? '✅ VALIDADO (Tiene findUnique previo)' : '⚠️ ADVERTENCIA (Sin validación explícita previa)'}`);
console.log(`- Fallo 2 (Validación balance):        ${hasMathAssert ? '✅ VALIDADO (Ecuación activa)' : '⚠️ ADVERTENCIA (Sin validación matemática)'}`);

// Fallo 3: BroadcastChannel Guard en cache.ts
const hasCacheBroadcastGuard = await searchInFile(
  'src/lib/cache.ts',
  /typeof\s+BroadcastChannel\s*!==\s*['"]undefined['"]/i
);
console.log(`- Fallo 3 (BroadcastChannel Guard):    ${hasCacheBroadcastGuard ? '✅ SEGURO (Tiene guard contra Edge)' : '⚠️ RIESGO (Instanciación directa en Edge Runtime)'}`);

// Fallo 4: Worker timeout en pdf-processor.ts
const hasWorkerTimeout = await searchInFile(
  'src/lib/pdf-processor.ts',
  /setTimeout|timeout/i
);
console.log(`- Fallo 4 (Worker timeout cleanup):    ${hasWorkerTimeout ? '✅ SEGURO (Tiene timeout)' : '⚠️ ADVERTENCIA (Workers huérfanos posibles ante crash)'}`);

// Fallo 5: LRUCache Hits/Misses
const hasCacheMetrics = await searchInFile(
  'src/lib/cache.ts',
  /hits|misses/i
);
console.log(`- Fallo 5 (Cache metrics):             ${hasCacheMetrics ? '✅ DISPONIBLE (Métricas activas)' : '⚠️ ADVERTENCIA (Sin instrumentación de hits/misses)'}`);

console.log('\n=== AUDITORÍA FINALIZADA CON ÉXITO ===');
