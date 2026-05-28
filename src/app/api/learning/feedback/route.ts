import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { recordFeedback } from '@/lib/learning/adaptive-engine';
import { getSessionUserId } from '@/lib/sessions';

export const PATCH = apiHandler(async (req: NextRequest) => {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { companyId, bankDescription, glAccountCode, confidence } = await req.json();
  if (!companyId || !bankDescription || !glAccountCode) {
    throw new Error('Faltan parámetros requeridos para feedback');
  }

  await recordFeedback({
    timestamp: new Date().toISOString(),
    bankDescription,
    selectedGlAccountCode: glAccountCode,
    confidence: confidence ?? 1.0,
    userId,
    companyId,
  });

  return NextResponse.json({
    success: true,
    message: 'Feedback registrado para entrenamiento local',
  });
});
