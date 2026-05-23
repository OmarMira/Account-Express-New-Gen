import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);

async function run() {
  // This is how we'll do it in Next.js server context:
  // Use require.resolve to get the real path to the worker
  try {
    const workerRealPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const workerUrl = pathToFileURL(workerRealPath).href;
    console.log('Worker resolved to:', workerRealPath);
    console.log('Worker URL:', workerUrl);
    
    // Import pdfjs from its real path
    const pdfjsRealPath = req.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjs = await import(pathToFileURL(pdfjsRealPath).href);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    
    const minimalPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 700 Td (01/15/2025 PAYROLL 2500.00) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000274 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
370
%%EOF`;

    const buffer = Buffer.from(minimalPdf);
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str || '').join(' ');
      fullText += pageText + '\n';
    }
    console.log('SUCCESS! Text:', fullText.trim());
  } catch(e) {
    console.error('FAILED:', e.message);
    console.error(e.stack?.substring(0, 500));
  }
}
run().catch(console.error);
