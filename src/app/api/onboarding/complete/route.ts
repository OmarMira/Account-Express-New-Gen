import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { completeOnboarding } from '@/services/onboarding.service';

export async function POST(request: NextRequest) {
  try {
    // 1. Verificar autenticación del usuario
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // 2. Parsear el body de la petición
    const body = await request.json();
    const { companyId, fiscalYearStartMonth, fiscalYearStartYear } = body;

    if (!companyId) {
      return NextResponse.json({ error: 'El parámetro companyId es requerido' }, { status: 400 });
    }

    const startMonth = parseInt(fiscalYearStartMonth, 10);
    const startYear = fiscalYearStartYear ? parseInt(fiscalYearStartYear, 10) : 2025;

    if (isNaN(startMonth) || startMonth < 1 || startMonth > 12) {
      return NextResponse.json({ error: 'Mes de inicio fiscal inválido' }, { status: 400 });
    }

    if (isNaN(startYear) || startYear < 2000 || startYear > 2100) {
      return NextResponse.json({ error: 'Año de inicio fiscal inválido' }, { status: 400 });
    }

    // 3. Verificar membresía y rol administrativo en la compañía
    const membership = await db.companyMember.findFirst({
      where: {
        userId,
        companyId,
        role: 'company_admin', // solo admins pueden realizar onboarding
      },
    });

    if (!membership) {
      return NextResponse.json(
        { error: 'Acceso denegado: Se requieren privilegios de administrador' },
        { status: 403 },
      );
    }

    // 4. Ejecutar el servicio de onboarding
    const result = await completeOnboarding(companyId, startMonth, startYear);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API ONBOARDING COMPLETE ERROR]', error);
    return NextResponse.json(
      { error: error.message || 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
