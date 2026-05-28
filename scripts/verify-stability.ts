#!/usr/bin/env bun
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const projectRoot = process.cwd();
const checks: { name: string; pass: boolean; detail?: string }[] = [];

function check(name: string, condition: boolean, detail?: string) {
  checks.push({ name, pass: condition, detail });
}

// 1. WAL Mode en SQLite
const envPath = join(projectRoot, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  check('1. WAL Mode en SQLite', envContent.includes('journal_mode=WAL'), 
    'DATABASE_URL debe incluir ?journal_mode=WAL&synchronous=NORMAL');
} else {
  check('1. WAL Mode en SQLite', false, '.env no encontrado en la raíz');
}

// 2. Worker PDF Centralizado e Idempotente
const workerExists = existsSync(join(projectRoot, 'src/lib/pdf-worker.ts'));
const instrumentPath = join(projectRoot, 'src/instrumentation.ts');
const instrumentContent = existsSync(instrumentPath) ? readFileSync(instrumentPath, 'utf-8') : '';
const instrumentCheck = instrumentContent.includes('initPdfWorker()') && instrumentContent.includes('NEXT_RUNTIME');
check('2. Worker PDF Centralizado', workerExists && instrumentCheck, 
  'Debe existir pdf-worker.ts y llamarse en instrumentation.ts con guard de runtime');

// 3. Middleware de Validación API
const validateExists = existsSync(join(projectRoot, 'src/lib/validate-request.ts'));
check('3. Validación de APIs (Zod)', validateExists, 
  'validate-request.ts debe existir en src/lib/ para interceptar payloads POST/PATCH');

// 4. Hardening de Cookies de Sesión
const loginRoute = join(projectRoot, 'src/app/api/auth/login/route.ts');
if (existsSync(loginRoute)) {
  const loginContent = readFileSync(loginRoute, 'utf-8');
  const hasHttpOnly = loginContent.includes('httpOnly: true');
  const hasSecure = loginContent.includes('secure:');
  const hasSameSite = loginContent.includes('sameSite:');
  check('4. Hardening Cookies', hasHttpOnly && hasSecure && hasSameSite, 
    'Login route debe incluir httpOnly: true, secure, sameSite: lax');
} else {
  check('4. Hardening Cookies', false, 'src/app/api/auth/login/route.ts no encontrado');
}

// 5. Vitest Global Teardown
const vitestConfig = readFileSync(join(projectRoot, 'vitest.config.ts'), 'utf-8');
const teardownExists = existsSync(join(projectRoot, 'tests/globalTeardown.ts'));
check('5. Vitest Cleanup', vitestConfig.includes('globalTeardown:') && teardownExists, 
  'Config y archivo de teardown deben existir para limpiar test.db');

// 6. Repo Limpio (Scripts de Prueba Eliminados)
const testFiles = [
  'test-pdf-parse.js', 'test-pdf-parse.mjs', 'test-pdf.mjs',
  'test-pdfjs-direct.mjs', 'test-resolve.mjs', 'test-setworker.mjs',
  'test-gettext.js', 'test-parse.js', 'check-pdf-parse.js', 'check-paths.js'
];
const anyTestFileExists = testFiles.some(f => existsSync(join(projectRoot, f)));
check('6. Repo Limpio', !anyTestFileExists, 
  'Archivos test-* y check-* deben eliminarse antes de mergear');

// ─── OUTPUT ─────────────────────────────────────────────────────────────────
console.log('\n🔍 VERIFICACIÓN DE ESTABILIDAD (FASE 5)');
console.log('═'.repeat(45));

let allPassed = true;
for (const c of checks) {
  const status = c.pass ? '✅' : '❌';
  console.log(`${status} ${c.name}`);
  if (c.detail && !c.pass) console.log(`   ⚠️  ${c.detail}`);
  if (!c.pass) allPassed = false;
}

console.log('═'.repeat(45));
if (allPassed) {
  console.log('🎉 ¡SISTEMA PRODUCTION-READY! Todos los controles pasaron.');
  console.log('💡 Siguiente: bun run build → git commit → merge');
  process.exit(0);
} else {
  console.log('⚠️  REVISIÓN REQUERIDA: Algunos controles fallaron.');
  console.log('🔧 Corrige los puntos marcados con ❌ antes de desplegar.');
  process.exit(1);
}
