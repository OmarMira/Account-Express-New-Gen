import { parsePDF } from '../src/lib/pdf-parser';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_PATH = process.env.FIXTURES_PATH || join(process.cwd(), 'tests/fixtures/boa-statements');

const months = [
  { m: '01', day: '31', dep: 7, wit: 13 }, // eStmt_2025-01-31.pdf
  { m: '02', day: '28', dep: 6, wit: 12 },
  { m: '03', day: '31', dep: 7, wit: 14 },
  { m: '04', day: '30', dep: 5, wit: 11 },
  { m: '05', day: '30', dep: 9, wit: 16 },
];

async function main() {
  console.log('🔍 Validando parser geométrico con 5 PDFs reales...\n');
  
  let allPassed = true;
  
  for (const month of months) {
    const filename = `eStmt_2025-${month.m}-${month.day}.pdf`;
    const pdfBuffer = readFileSync(join(FIXTURES_PATH, filename));
    
    try {
      const result = await parsePDF(pdfBuffer);
      
      // Validación matemática
      const credits = result.transactions.filter(t => t.amount >= 0);
      const debits = result.transactions.filter(t => t.amount < 0);
      const totalCredits = credits.reduce((sum, t) => sum + t.amount, 0);
      const totalDebits = Math.abs(debits.reduce((sum, t) => sum + t.amount, 0));
      const calculatedClosing = (result.openingBalance ?? 0) + totalCredits - totalDebits;
      const difference = Math.abs(calculatedClosing - (result.closingBalance ?? 0));
      
      const mathValid = difference < 0.01;
      const depCount = credits.length;
      const witCount = debits.length;
      
      console.log(`📄 ${filename}:`);
      console.log(`   Transacciones: ${result.transactions.length} (${depCount} depósitos, ${witCount} retiros)`);
      console.log(`   Opening: $${(result.openingBalance ?? 0).toFixed(2)}`);
      console.log(`   Closing: $${(result.closingBalance ?? 0).toFixed(2)}`);
      console.log(`   Calculated: $${calculatedClosing.toFixed(2)}`);
      console.log(`   Diferencia: $${difference.toFixed(2)} ${mathValid ? '✅' : '❌'}`);
      console.log('');
      
      if (!mathValid) allPassed = false;
    } catch (error) {
      console.error(`❌ Error parseando ${filename}:`, error);
      allPassed = false;
    }
  }
  
  if (allPassed) {
    console.log('✅ TODOS LOS PDFS VALIDADOS CORRECTAMENTE');
    process.exit(0);
  } else {
    console.error('❌ VALIDACIÓN FALLÓ - Revisar parser');
    process.exit(1);
  }
}

main().catch(console.error);
