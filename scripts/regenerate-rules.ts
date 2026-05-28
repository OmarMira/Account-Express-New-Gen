import { db } from '@/lib/db';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { generateCandidateRules } from '@/lib/learning/adaptive-engine';

async function run() {
  console.log('🧠 Generando reglas candidatas desde feedback humano...');

  // Resolver COMPANY_ID dinámicamente
  let companyId = process.env.COMPANY_ID || '';
  if (!companyId) {
    const firstCompany = await db.company.findFirst();
    if (!firstCompany) {
      throw new Error('No se encontró ninguna compañía en la base de datos.');
    }
    companyId = firstCompany.id;
    console.log(`- COMPANY_ID no provisto. Usando primera compañía encontrada: "${firstCompany.legalName}" (ID: ${companyId})`);
  } else {
    console.log(`- Usando COMPANY_ID provisto: ${companyId}`);
  }

  const candidates = generateCandidateRules(companyId);
  
  if (candidates.length === 0) {
    console.log('✅ No hay suficientes datos para generar nuevas reglas.');
    return;
  }

  const rulesPath = join(process.cwd(), 'rules/bank-mapping.json');
  const currentRules = JSON.parse(readFileSync(rulesPath, 'utf-8'));
  const backupPath = `${rulesPath}.bak.${Date.now()}`;
  
  copyFileSync(rulesPath, backupPath);
  console.log(`📦 Backup creado: ${backupPath}`);

  // Fusionar candidaturas con reglas existentes (evita duplicados)
  const existingPatterns = currentRules.rules.map((r: any) => r.pattern);
  const newRules = candidates.filter(c => !existingPatterns.includes(c.pattern));
  
  if (newRules.length === 0) {
    console.log('✅ Todas las reglas candidatas ya existen en el archivo de mapeo bancario.');
    return;
  }

  currentRules.rules.push(...newRules);
  currentRules.version = (parseInt(currentRules.version) + 1).toString();
  currentRules.lastUpdated = new Date().toISOString();
  currentRules.autoApplied = false; // Requiere revisión en UI

  writeFileSync(rulesPath, JSON.stringify(currentRules, null, 2));
  console.log(`✅ ${newRules.length} reglas candidatas agregadas a v${currentRules.version}`);
  console.log('⚠️ Estado: pending_review. Valida en UI antes de activar auto-aplicación.');
}

run().catch(console.error);
