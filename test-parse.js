const path = require('path');
const { pathToFileURL } = require('url');
const { PDFParse } = require('./node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs');
const fs = require('fs');

async function testParse() {
  const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
  const workerUrl = pathToFileURL(workerPath).href;
  console.log('Setting worker to:', workerUrl);
  PDFParse.setWorker(workerUrl);
  
  // Use a tiny real PDF or create a test buffer
  // We'll just test if PDFParse instantiation works without errors
  try {
    // Create a minimal PDF to test parsing
    const testPdfPath = path.join(process.cwd(), '..', '..', '..', 'Downloads', 'eStmt_2025-01-31.pdf');
    if (fs.existsSync(testPdfPath)) {
      const buffer = fs.readFileSync(testPdfPath);
      const parser = new PDFParse(new Uint8Array(buffer));
      const data = await parser.getText();
      console.log('SUCCESS! Text length:', data.text.length);
      console.log('First 200 chars:', data.text.substring(0, 200));
    } else {
      console.log('Test PDF not found at', testPdfPath);
      // Just test instantiation
      const parser = new PDFParse(new Uint8Array([0]));
      console.log('Parser created OK, no PDF to test');
    }
  } catch(e) {
    console.error('ERROR:', e.message);
  }
}

testParse();
