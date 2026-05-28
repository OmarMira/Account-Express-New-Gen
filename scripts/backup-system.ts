import { db } from '@/lib/db';
import { mkdir, copyFile, readFile, writeFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { readFileSync, createWriteStream } from 'fs';

const CONFIG_PATH = join(process.cwd(), 'rules/backup-config.json');
const DB_URL = process.env.DATABASE_URL || "file:c:/Users/PC Omar/Downloads/sistema/prisma/dev.db";

function getDbPath() {
  if (!DB_URL?.startsWith('file:')) throw new Error('DATABASE_URL debe ser un archivo SQLite local');
  // Quitar 'file:' de forma segura sin romper la letra de unidad en Windows
  const pathPart = DB_URL.substring(5).split('?')[0];
  return decodeURIComponent(pathPart);
}

async function backupSystem() {
  console.log('📦 Iniciando backup automatizado...');
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  const dbPath = getDbPath();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(process.cwd(), config.backupDir);
  await mkdir(backupDir, { recursive: true });

  // Resolver COMPANY_ID dinámicamente
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

  // 1. Checkpoint WAL para evitar corrupción
  if (config.preBackupCheckpoints) {
    console.log('🔹 Ejecutando WAL checkpoint...');
    await db.$queryRaw`PRAGMA journal_mode=WAL;`;
    await db.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE);`;
  }

  // 2. Copia segura
  const tempFile = join(backupDir, `snapshot-${timestamp}.db`);
  await copyFile(dbPath, tempFile);

  // 3. Compresión
  let finalPath = tempFile;
  if (config.compression) {
    const gzPath = `${tempFile}.gz`;
    const gzip = createGzip();
    const source = readFileSync(tempFile);
    const dest = createWriteStream(gzPath);
    
    await new Promise<void>((resolve, reject) => {
      gzip.pipe(dest);
      gzip.write(source);
      gzip.end();
      dest.on('finish', () => resolve());
      dest.on('error', (err) => reject(err));
    });
    
    await unlink(tempFile);
    finalPath = gzPath;
  }

  // 4. Hash de integridad
  const fileContent = readFileSync(finalPath);
  const hash = createHash('sha256').update(fileContent).digest('hex');
  const metaPath = `${finalPath}.meta.json`;
  await writeFile(metaPath, JSON.stringify({
    originalDb: dbPath,
    createdAt: new Date().toISOString(),
    sizeBytes: fileContent.length,
    sha256: hash,
    configVersion: config.version
  }, null, 2));

  // 5. Limpieza de retención
  const files = await readdir(backupDir);
  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  for (const f of files) {
    if (!f.startsWith('snapshot-')) continue;
    const stat = await (await import('fs/promises')).stat(join(backupDir, f));
    if (stat.mtimeMs < cutoff) await unlink(join(backupDir, f));
  }

  // 6. Auditoría
  await db.auditLog.create({
    data: {
      companyId: companyId,
      action: 'BACKUP_CREATED',
      entity: 'Company',
      entityId: companyId,
      details: JSON.stringify({ file: finalPath, hash, sizeBytes: fileContent.length })
    }
  });

  console.log(`✅ Backup completado: ${finalPath}`);
  console.log(`🔐 SHA-256: ${hash}`);
  return { path: finalPath, hash };
}

backupSystem().catch(err => {
  console.error('❌ Error en backup:', err);
  process.exit(1);
});
