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
if (!isEdge && db) {
  db.$connect()
    .then(async () => {
      try {
        await db.$executeRawUnsafe(`PRAGMA journal_mode=WAL;`);
        await db.$executeRawUnsafe(`PRAGMA synchronous=NORMAL;`);
        console.log('✅ Base de datos configurada en modo WAL para alta concurrencia.');
      } catch (err) {
        console.warn('⚠️ Fallo al activar WAL mode:', err);
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
