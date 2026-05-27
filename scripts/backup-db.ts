import { promises as fs } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function backup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(process.cwd(), 'backups');
  await fs.mkdir(backupDir, { recursive: true });

  const source = join(process.cwd(), 'prisma', 'dev.db');
  const sourceWal = join(process.cwd(), 'prisma', 'dev.db-wal');
  const dest = join(backupDir, `backup-${timestamp}.db`);
  const destWal = join(backupDir, `backup-${timestamp}.db-wal`);
  const archive = join(backupDir, `backup-${timestamp}.tar.gz`);

  if (!(await fileExists(source))) {
    console.error('❌ Base de datos no encontrada:', source);
    process.exit(1);
  }

  // Copiar archivos de SQLite (db + WAL si existe)
  await fs.copyFile(source, dest);
  const walExists = await fileExists(sourceWal);
  if (walExists) {
    await fs.copyFile(sourceWal, destWal);
  }

  // Comprimir
  const filesToCompress = walExists ? `"${dest}" "${destWal}"` : `"${dest}"`;
  await execAsync(`tar -czf "${archive}" ${filesToCompress}`);

  // Limpiar archivos temporales
  await fs.unlink(dest);
  if (walExists) await fs.unlink(destWal);

  console.log(`✅ Backup creado: backups/backup-${timestamp}.tar.gz`);

  // ─── Retención: mantener últimos 30 backups ───────────────────────
  const entries = await fs.readdir(backupDir);
  const archives = entries.filter((f) => f.endsWith('.tar.gz')).sort();

  if (archives.length > 30) {
    const toDelete = archives.slice(0, archives.length - 30);
    for (const old of toDelete) {
      await fs.unlink(join(backupDir, old));
      console.log(`🗑️  Backup antiguo eliminado: ${old}`);
    }
  }

  console.log(`📦 Total backups almacenados: ${Math.min(archives.length, 30)}`);
}

backup().catch((err) => {
  console.error('❌ Error en backup:', err.message);
  process.exit(1);
});
