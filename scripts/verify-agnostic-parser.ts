import { readFileSync } from 'fs';
import { join } from 'path';

const PARSER_PATH = join(process.cwd(), 'src/lib/pdf-parser.ts');
const FORBIDDEN_WORDS = ['Chase', 'Wells Fargo', 'Bank of America', 'Citi'];

function main() {
  console.log('🔍 Executing Anti-Hardcode Gate...');
  const content = readFileSync(PARSER_PATH, 'utf-8');
  
  let failed = false;
  for (const word of FORBIDDEN_WORDS) {
    // Check for exact word case-insensitively
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(content)) {
      console.error(`❌ FAILED: Found forbidden bank name "${word}" in ${PARSER_PATH}`);
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  } else {
    console.log('✅ PASS: No hardcoded bank names found in parser.');
    process.exit(0);
  }
}

main();
