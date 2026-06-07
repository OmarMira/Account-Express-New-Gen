import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { ValidationError } from '@/lib/api-error';
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
  const { companyId } = requireCompanyContext();

  const { searchParams } = new URL(request.url);
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');

  if (!startDateStr || !endDateStr) {
    throw new ValidationError(
      'Los parámetros startDate y endDate son requeridos en formato YYYY-MM-DD',
    );
  }

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
