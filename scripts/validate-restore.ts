import { db } from '@/lib/db';
import { mkdir, readFile, readdir, unlink, rm } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { createGunzip } from 'zlib';
import { readFileSync, writeFileSync, createWriteStream, existsSync } from 'fs';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

async function run() {
  console.log('🧪 Iniciando prueba de restore aislado (Cero Riesgo)...');

  const backupDir = join(process.cwd(), 'backups');
  const tempDir = join(backupDir, 'temp-validation');
  await mkdir(tempDir, { recursive: true });

  // 1. Encontrar el último backup .gz
  const files = await readdir(backupDir);
  const gzFiles = files.filter(f => f.endsWith('.gz')).sort();
  if (gzFiles.length === 0) {
    throw new Error('No se encontraron archivos de backup .gz');
  }
  const latestGz = gzFiles[gzFiles.length - 1];
  const gzPath = join(backupDir, latestGz);
  const metaPath = `${gzPath}.meta.json`;

  console.log(`- Último backup detectado: ${latestGz}`);

  if (!existsSync(metaPath)) {
    throw new Error(`Archivo meta.json no encontrado: ${metaPath}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));

  // 2. Verificar hash SHA-256 del archivo comprimido
  const gzContent = readFileSync(gzPath);
  const gzHash = createHash('sha256').update(gzContent).digest('hex');

  console.log(`- SHA-256 esperado: ${meta.sha256}`);
  console.log(`- SHA-256 obtenido: ${gzHash}`);

  if (gzHash !== meta.sha256) {
    throw new Error('❌ HASH MISMATCH! Integridad comprometida.');
  }
  console.log('✅ HASH MATCH EXITOSO.');

  // 3. Descomprimir backup a temp.db
  console.log('🔹 Descomprimiendo base de datos...');
  const tempDbPath = join(tempDir, 'temp.db');
  
  const gunzip = createGunzip();
  const dest = createWriteStream(tempDbPath);
  
  await new Promise<void>((resolve, reject) => {
    gunzip.pipe(dest);
    gunzip.write(gzContent);
    gunzip.end();
    dest.on('finish', () => resolve());
    dest.on('error', (err) => reject(err));
  });

  // 4. Validar integridad SQLite nativa
  console.log('🔹 Validando integridad SQLite nativa...');
  const tempPrisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${tempDbPath}`
      }
    }
  });

  try {
    const integrityCheck = await tempPrisma.$queryRawUnsafe<any[]>('PRAGMA integrity_check;');
    const integrityResult = integrityCheck[0]?.integrity_check || 'ok';
    console.log(`- Resultado de PRAGMA integrity_check: ${integrityResult}`);
    if (integrityResult !== 'ok') {
      throw new Error('SQLite integrity check failed!');
    }
    console.log('✅ PRAGMA INTEGRITY CHECK: PASS.');
  } finally {
    await tempPrisma.$disconnect();
  }

  // 5. Ejecutar run-full-cycle-check contra la copia temporal
  console.log('🔹 Ejecutando cycle check contra base de datos temporal...');
  const projectDir = process.cwd();
  
  // Ejecutar el script usando cross-env en Windows/Unix
  try {
    execSync(`bun run scripts/run-full-cycle-check.ts`, {
      env: {
        ...process.env,
        DATABASE_URL: `file:${tempDbPath}`
      },
      cwd: projectDir,
      stdio: 'inherit'
    });
    console.log('✅ CICLO COMPLETO DE VERIFICACIÓN: PASS.');
  } catch (err) {
    console.error('❌ Error ejecutando validación del ciclo completo:', err);
    throw err;
  }

  // 6. Limpieza segura
  console.log('🔹 Eliminando archivos temporales...');
  await rm(tempDir, { recursive: true, force: true });
  console.log('🧹 Limpieza completada.');
  
  console.log('\n🎉 PRUEBA DE RESTORE REALIZADA Y TOTALMENTE VALIDADA CON ÉXITO.');
}

run().catch(err => {
  console.error('❌ Error en validación de restore:', err);
  process.exit(1);
});
