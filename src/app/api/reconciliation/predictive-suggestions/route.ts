import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { generateSuggestions } from '@/lib/reconciliation/predictive-engine';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getSessionUserId } from '@/lib/sessions';
import { db } from '@/lib/db';

export const GET = apiHandler(async (req: NextRequest) => {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('companyId');
  const bankAccountId = searchParams.get('bankAccountId');

  if (!companyId || !bankAccountId) {
    return NextResponse.json(
      { error: 'companyId y bankAccountId son requeridos' },
      { status: 400 },
    );
  }

  // Verificar membresía del usuario
  const membership = await db.companyMember.findFirst({
    where: { userId, companyId },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const config = JSON.parse(
    readFileSync(join(process.cwd(), 'rules/predictive-recon.json'), 'utf-8'),
  );
  const suggestions = await generateSuggestions(companyId, bankAccountId);

  // Auditoría de sugerencias mostradas
  await db.auditLog.create({
    data: {
      companyId,
      action: config.auditActions.shown,
      entity: 'Company',
      entityId: companyId,
      details: JSON.stringify({ count: suggestions.length, threshold: config.confidenceThreshold }),
    },
  });

  return NextResponse.json({ suggestions, generatedAt: new Date().toISOString() });
});
