import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { apiHandler } from '@/lib/api-handler';
import { AuthError, ForbiddenError, ValidationError } from '@/lib/api-error';
import { aggregateAccountingFlow } from '@/lib/accounting/flow-aggregator';

/**
 * GET /api/accounting-flow
 *
 * Devuelve el flujo contable consolidado de la empresa (Inflows, Outflows, NetFlow,
 * desglosado por periodo y cuenta, con la lista completa de movimientos).
 *
 * Query Params:
 *   - companyId: string (requerido)
 *   - startDate: string (ISO YYYY-MM-DD, requerido)
 *   - endDate: string (ISO YYYY-MM-DD, requerido)
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) throw new AuthError();

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('companyId');
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');

  if (!companyId) {
    throw new ValidationError('El parámetro companyId es requerido');
  }

  if (!startDateStr || !endDateStr) {
    throw new ValidationError(
      'Los parámetros startDate y endDate son requeridos en formato YYYY-MM-DD',
    );
  }

  // Verificar membresía del usuario en la compañía
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) throw new ForbiddenError();

  const startDate = new Date(startDateStr);
  const endDate = new Date(`${endDateStr}T23:59:59.999Z`);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new ValidationError('Fechas inválidas. Use el formato YYYY-MM-DD');
  }

  const result = await aggregateAccountingFlow(db, {
    companyId,
    startDate,
    endDate,
  });

  return NextResponse.json(result);
});
