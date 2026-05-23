const path = require('path');
const { pathToFileURL } = require('url');
const { PDFParse } = require('./node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs');

const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
const fs = require('fs');
console.log('Worker path:', workerPath);
console.log('Worker exists:', fs.existsSync(workerPath));
console.log('Worker URL:', pathToFileURL(workerPath).href);

// Check what's in pdfjs-dist
const pdfjsDistPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
console.log('pdfjs-dist exists:', fs.existsSync(pdfjsDistPath));
if (fs.existsSync(pdfjsDistPath)) {
  const legacyBuild = path.join(pdfjsDistPath, 'legacy', 'build');
  console.log('legacy/build exists:', fs.existsSync(legacyBuild));
  if (fs.existsSync(legacyBuild)) {
    console.log('Files in legacy/build:', fs.readdirSync(legacyBuild).join(', '));
  }
  // Also check root build
  const rootBuild = path.join(pdfjsDistPath, 'build');
  console.log('build exists:', fs.existsSync(rootBuild));
  if (fs.existsSync(rootBuild)) {
    console.log('Files in build:', fs.readdirSync(rootBuild).join(', '));
  }
}

// Also check what pdf-parse has bundled
const pdfParsePath = path.join(process.cwd(), 'node_modules', 'pdf-parse');
const pdfParseContents = fs.readdirSync(pdfParsePath);
console.log('pdf-parse root:', pdfParseContents.join(', '));

