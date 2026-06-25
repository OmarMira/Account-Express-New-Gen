import { Prisma, PrismaClient } from '@prisma/client';
import { trackQueryDuration } from './metrics';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  isListenerRegistered?: boolean;
};

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

const isEdge = process.env.NEXT_RUNTIME === 'edge';

// ─── Query Profiling Singleton ───────────────────────────────────────────────
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
