import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { apiHandler } from '@/lib/api-handler';
import { AuthError, ForbiddenError, ValidationError } from '@/lib/api-error';
import { aggregateAccountingFlow } from '@/lib/accounting/flow-aggregator';
import { formatFlowToCSV } from '@/lib/accounting/export-formatter';

// Simple in-memory rate limiting store (IP -> Request Timestamps)
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hora
  const maxRequests = 15;

  const timestamps = rateLimitMap.get(ip) || [];
  // Filtrar viejos timestamps
  const activeTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (activeTimestamps.length >= maxRequests) {
    return false;
  }

  activeTimestamps.push(now);
  rateLimitMap.set(ip, activeTimestamps);
  return true;
}

/**
 * GET /api/accounting-flow/export
 *
 * Exporta el flujo contable a formato CSV con streaming NextResponse y auditoría estructurada.
 *
 * Query Params:
 *   - companyId: string (requerido)
 *   - startDate: string (ISO YYYY-MM-DD, requerido)
 *   - endDate: string (ISO YYYY-MM-DD, requerido)
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) throw new AuthError();

  const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
  if (!checkRateLimit(ip)) {
    return new NextResponse(
      JSON.stringify({
        error: 'Demasiadas solicitudes de exportación. Intenta de nuevo más tarde.',
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

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

  // Verificar membresía
  const company = await db.company.findUnique({
    where: { id: companyId },
    include: {
      members: {
        where: { userId },
      },
    },
  });

  if (!company || company.members.length === 0) {
    throw new ForbiddenError();
  }

  const startDate = new Date(startDateStr);
  const endDate = new Date(`${endDateStr}T23:59:59.999Z`);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new ValidationError('Fechas inválidas. Use el formato YYYY-MM-DD');
  }

  // Generar datos
  const data = await aggregateAccountingFlow(db, {
    companyId,
    startDate,
    endDate,
  });

  // Log estructurado de auditoría (JSON)
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'export_triggered',
      companyId,
      userId,
      recordCount: data.transactions.length,
      timestamp: new Date().toISOString(),
    }),
  );

  const csvContent = formatFlowToCSV(data.transactions, company.legalName);

  const filename = `flujo-contable-${startDateStr}-a-${endDateStr}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
