import { PrismaClient } from '@prisma/client';
import { trackQueryDuration } from './metrics';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const isEdge = process.env.NEXT_RUNTIME === 'edge';

export const db = isEdge
  ? (null as unknown as PrismaClient)
  : (globalForPrisma.prisma ??
    new PrismaClient({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ],
    }));

// Optimización para SQLite (WAL Mode)
// PRAGMA journal_mode returns a result row, so we must use $queryRawUnsafe.
// $executeRawUnsafe rejects any query that returns rows in SQLite.
if (!isEdge && db) {
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

// ─── Query Profiling ─────────────────────────────────────────────────────────
// Track all queries; log slow ones (>100ms); alert on critical ones (>500ms).
if (!isEdge && db) {
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
}

if (!isEdge && process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
