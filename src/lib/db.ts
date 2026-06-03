import { PrismaClient } from '@prisma/client';
import { trackQueryDuration } from './metrics';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  isListenerRegistered?: boolean;
};

// Configuración correcta para poder emitir eventos 'query'
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'warn', emit: 'stdout' },
      { level: 'error', emit: 'stdout' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

// Optimización para SQLite (WAL Mode)
const isEdge = process.env.NEXT_RUNTIME === 'edge';
if (!isEdge && db && !globalForPrisma.prisma) {
  db.$connect()
    .then(async () => {
      try {
        const [{ journal_mode }] =
          await db.$queryRawUnsafe<{ journal_mode: string }[]>(`PRAGMA journal_mode=WAL;`);
        await db.$queryRawUnsafe(`PRAGMA synchronous=NORMAL;`);
        logger.info('SQLITE_OPTIMIZED', {
          journalMode: journal_mode,
          cacheSize: '20MB',
          busyTimeout: '5000ms',
        });
      } catch (err) {
        logger.warn('SQLITE_WAL_SKIPPED', { reason: String(err) });
      }
    })
    .catch((err) => {
      console.error('⚠️ DB connect failed:', err);
    });
}

// ─── Query Profiling Singleton real ─────────────────────────────────────────
if (!isEdge && db && !globalForPrisma.isListenerRegistered) {
  (db as any).$on('query', (e: any) => {
    const duration = e.duration as number;
    const query = e.query as string;

    trackQueryDuration(query, duration);

    if (duration > 100) {
      logger.slowQuery(query, duration);
    }

    if (duration > 500) {
      import('./alerts')
        .then(({ alertIfSlowQuery }) => {
          alertIfSlowQuery(duration, query);
        })
        .catch(() => {});
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.isListenerRegistered = true;
  }
}
