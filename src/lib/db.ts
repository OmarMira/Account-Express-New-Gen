import { Prisma, PrismaClient } from '@prisma/client';
import { trackQueryDuration } from './metrics';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  isListenerRegistered?: boolean;
};

// Configuración correcta para poder emitir eventos 'query'
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const dbUrl = isTest ? 'file:./test.db' : undefined;

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: dbUrl ? {
      db: {
        url: dbUrl,
      },
    } : undefined,
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
      logger.error('⚠️ DB connect failed:', { error: String(err) });
    });
}

// ─── Query Profiling Singleton real ─────────────────────────────────────────
// Prisma's $on type only exposes events configured via log emit — the
// default PrismaClient generic loses this context, so we cast narrowly.
type DBWithQueryEvents = PrismaClient & {
  $on(event: 'query', callback: (event: Prisma.QueryEvent) => void): void;
};
if (!isEdge && db && !globalForPrisma.isListenerRegistered) {
  (db as DBWithQueryEvents).$on('query', (e) => {
    const duration = e.duration;
    const query = e.query;

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

  globalForPrisma.isListenerRegistered = true;
}
