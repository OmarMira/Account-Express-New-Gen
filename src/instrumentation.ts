// ─── Next.js Instrumentation Hook ────────────────────────────────────────────
// Called once when the server starts. Used to initialize SQLite PRAGMAs.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

// 1️⃣ POLYFILL: Debe ejecutarse ANTES de que cualquier módulo importe pdfjs-dist
if (typeof globalThis.DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    constructor() {}
    toString() {
      return 'matrix(1,0,0,1,0,0)';
    }
    static fromFloat32Array() {
      return new this();
    }
    static fromFloat64Array() {
      return new this();
    }
    multiply() {
      return this;
    }
  };
}

// 2️⃣ Importamos después de inyectar el polyfill
import { initPdfWorker } from './lib/pdf-worker';

// 3️⃣ Next.js 15+ soporta register() async
export async function register() {
  // Only run in Node.js runtime (server side)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Inicializa worker PDF + optimiza SQLite + resetea métricas
    await initPdfWorker();
    const { optimizeSQLite } = await import('./lib/db-optimizer');
    const { resetMetrics } = await import('./lib/metrics');
    const { startSessionCleanupInterval } = await import('./lib/maintenance/cleanupSessions');
    await optimizeSQLite();
    resetMetrics();
    startSessionCleanupInterval();
  }
}
