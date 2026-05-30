import { db } from '@/lib/db';

async function run() {
  console.log('⚡ Iniciando restauración de estado de onboarding en dev.db...');

  // Buscar la empresa del usuario
  const company = await db.company.findFirst({
    where: { legalName: { contains: 'LQ' } },
  });

  if (!company) {
    console.log('⚠️ No se encontró la empresa LQ & OM LLC en dev.db.');
    return;
  }

  // Restaurar el estado de onboarding
  await db.company.update({
    where: { id: company.id },
    data: { isOnboardingComplete: true },
  });

  console.log(`✅ Estado de onboarding restaurado exitosamente para: "${company.legalName}" (ID: ${company.id})`);
}

run().catch((err) => {
  console.error('❌ Error restaurando el onboarding:', err);
  process.exit(1);
});
