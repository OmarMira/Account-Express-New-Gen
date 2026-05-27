import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import { pathToFileURL } from 'url';

// Forzar modo fake worker de un solo hilo para entorno de tests unitarios (Node.js/Bun)
const workerPath = pathToFileURL(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;
pdfjs.GlobalWorkerOptions.workerSrc = workerPath;

