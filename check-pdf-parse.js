const m = require('./node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs');
console.log('EXPORTS:', Object.keys(m).join(', '));
if (m.PDFParse) {
  const keys = Object.getOwnPropertyNames(m.PDFParse).concat(Object.getOwnPropertyNames(m.PDFParse.prototype || {}));
  console.log('PDFParse static/prototype:', keys.join(', '));
}
if (m.default) {
  const keys2 = Object.getOwnPropertyNames(m.default).concat(Object.getOwnPropertyNames(m.default.prototype || {}));
  console.log('default static/prototype:', keys2.join(', '));
}
