import { db } from '../src/lib/db';

async function run() {
  console.log('🔄 Migrando campo legacy Company.address → streetLine1...');
  const companies = await db.company.findMany({
    where: { address: { not: null } }
  });

  if (companies.length === 0) {
    console.log('✅ No hay datos legacy para migrar.');
    return;
  }

  for (const c of companies) {
    if (c.address) {
      await db.company.update({
        where: { id: c.id },
        data: { streetLine1: c.address }
      });
    }
  }
  console.log(`✅ Migración completada: ${companies.length} empresas actualizadas.`);
}

run().catch(err => { console.error(err); process.exit(1); });
