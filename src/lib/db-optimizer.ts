// ─── SQLite Optimizer ────────────────────────────────────────────────────────
// Applies critical PRAGMA settings for performance.
// WAL mode active always (dev + production) — benefits concurrent reads during writes.

import { db } from './db';
import { logger } from './logger';

export async function optimizeSQLite() {
  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await db.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
    await db.$queryRawUnsafe('PRAGMA cache_size = -20000'); // 20MB cache
    await db.$queryRawUnsafe('PRAGMA temp_store = MEMORY');
    await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000'); // 5s retry on lock
    await db.$queryRawUnsafe('PRAGMA foreign_keys = ON');

    // Verify WAL mode
    const result = (await db.$queryRawUnsafe('PRAGMA journal_mode')) as any[];
    const journalMode = result?.[0]?.journal_mode;
    logger.info('SQLITE_OPTIMIZED', { journalMode, cacheSize: '20MB', busyTimeout: '5000ms' });
  } catch (error) {
    logger.error('SQLITE_OPTIMIZATION_FAILED', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
