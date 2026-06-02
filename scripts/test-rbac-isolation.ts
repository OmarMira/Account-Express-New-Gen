import { PATCH as feedbackPatch } from '../src/app/api/learning/feedback/route';
import { POST as assistantPost } from '../src/app/api/ai-assistant/route';
import { db } from '../src/lib/db';
import { createSession } from '../src/lib/sessions';
import { NextRequest } from 'next/server';

async function setupTestData() {
  const uniqueId = Math.random().toString(36).substring(7);
  const emailAuth = `auth-${uniqueId}@example.com`;
  const emailUnauth = `unauth-${uniqueId}@example.com`;

  // Create users
  const userAuth = await db.user.create({
    data: {
      email: emailAuth,
      passwordHash: 'placeholder',
      firstName: 'Authorized',
      lastName: 'User',
      role: 'company_admin',
    },
  });

  const userUnauth = await db.user.create({
    data: {
      email: emailUnauth,
      passwordHash: 'placeholder',
      firstName: 'Unauthorized',
      lastName: 'User',
      role: 'company_admin',
    },
  });

  // Create company
  const company = await db.company.create({
    data: {
      legalName: `Test Corp ${uniqueId}`,
      taxId: '12-3456789',
    },
  });

  // Create membership only for authorized user
  await db.companyMember.create({
    data: {
      userId: userAuth.id,
      companyId: company.id,
      role: 'company_admin',
    },
  });

  // Create sessions
  const tokenAuth = await createSession(userAuth.id);
  const tokenUnauth = await createSession(userUnauth.id);

  return {
    companyId: company.id,
    tokenAuth,
    tokenUnauth,
    cleanup: async () => {
      await db.session.deleteMany({ where: { token: { in: [tokenAuth, tokenUnauth] } } }).catch(() => {});
      await db.companyMember.deleteMany({ where: { companyId: company.id } }).catch(() => {});
      await db.company.delete({ where: { id: company.id } }).catch(() => {});
      await db.user.deleteMany({ where: { id: { in: [userAuth.id, userUnauth.id] } } }).catch(() => {});
    },
  };
}

async function runTests() {
  console.log('🔒 Iniciando pruebas de aislamiento Multi-Tenant (RBAC Isolation)...\n');

  const { companyId, tokenAuth, tokenUnauth, cleanup } = await setupTestData();
  let passed = 0;
  let failed = 0;

  try {
    // 1. Test feedback PATCH - Authorized
    console.log('🧪 Prueba 1: Acceso Autorizado a /api/learning/feedback (PATCH)');
    const req1 = new NextRequest('http://localhost/api/learning/feedback', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAuth}`,
      },
      body: JSON.stringify({
        companyId,
        bankDescription: 'Zelle payment',
        glAccountCode: '4010',
        confidence: 0.95,
      }),
    });
    const res1 = await feedbackPatch(req1, { params: {} });
    if (res1.status === 200) {
      console.log('   ✅ APROBADO: Retornó 200 OK');
      passed++;
    } else {
      console.error(`   ⛔ FALLADO: Retornó ${res1.status}`);
      failed++;
    }

    // 2. Test feedback PATCH - Unauthorized
    console.log('\n🧪 Prueba 2: Acceso No Autorizado a /api/learning/feedback (PATCH)');
    const req2 = new NextRequest('http://localhost/api/learning/feedback', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenUnauth}`,
      },
      body: JSON.stringify({
        companyId,
        bankDescription: 'Zelle payment',
        glAccountCode: '4010',
        confidence: 0.95,
      }),
    });
    const res2 = await feedbackPatch(req2, { params: {} });
    if (res2.status === 403) {
      console.log('   ✅ APROBADO: Bloqueado con 403 Forbidden');
      passed++;
    } else {
      console.error(`   ⛔ FALLADO: Retornó ${res2.status} (esperaba 403)`);
      failed++;
    }

    // 3. Test ai-assistant POST - Unauthorized
    console.log('\n🧪 Prueba 3: Acceso No Autorizado a /api/ai-assistant (POST)');
    const req3 = new NextRequest('http://localhost/api/ai-assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenUnauth}`,
      },
      body: JSON.stringify({
        message: 'Hola asistente',
        companyId,
      }),
    });
    const res3 = await assistantPost(req3);
    if (res3.status === 403) {
      console.log('   ✅ APROBADO: Bloqueado con 403 Forbidden');
      passed++;
    } else {
      console.error(`   ⛔ FALLADO: Retornó ${res3.status} (esperaba 403)`);
      failed++;
    }

  } catch (err) {
    console.error('\n❌ Error crítico durante la ejecución de pruebas:', err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log('\n📊 Resumen de Resultados:');
  console.log(`   ✅ Aprobados: ${passed}`);
  console.log(`   ❌ Fallidos: ${failed}`);

  if (failed === 0) {
    console.log('\n🌟 AISLAMIENTO MULTI-TENANT CORRECTAMENTE VALIDADO.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️ SE ENCONTRARON ERRORES DE SEGURIDAD. REVISAR ANTES DE SUBIR.\n');
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
