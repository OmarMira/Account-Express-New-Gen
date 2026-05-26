// ─── Next.js Instrumentation Hook ────────────────────────────────────────────
// Called once when the server starts. Used to initialize SQLite PRAGMAs.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run in Node.js runtime (server side) to prevent Edge runtime database execution
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { optimizeSQLite } = await import('./lib/db-optimizer');
    const { resetMetrics } = await import('./lib/metrics');

    await optimizeSQLite();
    resetMetrics();

    const { alertAggregator } = await import('./lib/alerts');

    process.on('beforeExit', () => {
      alertAggregator.flush().catch(() => {});
    });

    const sigtermHandler = () => {
      alertAggregator
        .flush()
        .catch(() => {})
        .finally(() => {
          if (typeof process.removeListener === 'function') {
            process.removeListener('SIGTERM', sigtermHandler);
          }
          if (typeof process.kill === 'function' && typeof process.pid !== 'undefined') {
            process.kill(process.pid, 'SIGTERM');
          }
        });
    };

    process.on('SIGTERM', sigtermHandler);
  }
}
