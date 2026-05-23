import fs from 'fs';
import { pathToFileURL } from 'url';

async function run() {
  try {
    const workerSrcPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjsSrcPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    console.log("workerSrcPath:", workerSrcPath);
    console.log("pdfjsSrcPath:", pdfjsSrcPath);
    
    const workerUrl = pathToFileURL(workerSrcPath).href;
    const pdfjsUrl = pathToFileURL(pdfjsSrcPath).href;
    
    console.log("pdfjsUrl:", pdfjsUrl);
    
    const pdfjs = await import(pdfjsUrl);
    console.log("pdfjs imported successfully");
    
    // Test parsing a dummy buffer
    const dummyBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Hello World) Tj\nET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000254 00000 n \n0000000347 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n435\n%%EOF\n');
    
    const data = new Uint8Array(dummyBuffer);
    const loadingTask = pdfjs.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    
    const pdf = await loadingTask.promise;
    console.log("pdf parsed! Pages:", pdf.numPages);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
