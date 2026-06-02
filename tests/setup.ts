import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execSync } from 'child_process';

// Configure PDF.js worker for Node/Bun environment
const workerPath = pathToFileURL(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;
pdfjs.GlobalWorkerOptions.workerSrc = workerPath;

// Ensure Prisma client is regenerated before tests run (in case pre-test script was skipped)
try {
  execSync('bun x prisma generate', { stdio: 'ignore' });
} catch (e) {
  console.warn('⚠️ Prisma generate failed in test setup, assuming it was run already.');
}

// Invalidate critical module caches to avoid stale Prisma client instances
const modulesToClear = ['@prisma/client', '@/lib/db'];
modulesToClear.forEach((mod) => {
  try {
    const resolved = require.resolve(mod);
    delete require.cache[resolved];
  } catch (_) {
    // Module not loaded yet, ignore
  }
});
