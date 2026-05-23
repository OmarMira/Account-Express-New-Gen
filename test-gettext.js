// Test full flow with setWorker and getText
const path = require('path');
const { pathToFileURL } = require('url');
const { PDFParse } = require('./node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs');

const workerPath = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
PDFParse.setWorker(pathToFileURL(workerPath).href);

// Build a minimal real PDF with text content
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

async function run() {
  try {
    const parser = new PDFParse(new Uint8Array(Buffer.from(minimalPdf)));
    const result = await parser.getText();
    console.log('SUCCESS! getText() worked');
    console.log('Text:', result.text.substring(0, 200));
  } catch(e) {
    console.error('FAILED:', e.message);
    console.error('Stack:', e.stack?.substring(0, 500));
  }
}
run();
