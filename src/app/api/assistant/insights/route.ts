import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { generateInsights } from '@/lib/assistant/insight-engine';
import { getSessionUserId } from '@/lib/sessions';
import { db } from '@/lib/db';
import { ValidationError, AuthError, ForbiddenError } from '@/lib/api-error';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export const GET = apiHandler(async (req: NextRequest) => {
  const userId = await getSessionUserId(req);
  if (!userId) {
    throw new AuthError();
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('companyId');
  if (!companyId) {
    throw new ValidationError('companyId is required');
  }

  // Get user role for this company
  const member = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!member) {
    throw new ForbiddenError();
  }

  const role = member.role;

  // Filter by allowed roles
  if (!['super_admin', 'admin', 'accountant'].includes(role)) {
    return NextResponse.json({ insights: [], message: 'Acceso restringido a roles financieros' });
  }

  const insights = await generateInsights(companyId, role);

  const configPath = join(process.cwd(), 'rules/assistant-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  await db.auditLog.create({
    data: {
      companyId,
      userId,
      action: config.auditActions.insightGenerated,
      entity: 'Assistant',
      details: JSON.stringify({
        count: insights.length,
        role,
        generatedAt: new Date().toISOString(),
      }),
    },
  });

  return NextResponse.json({ insights, generatedAt: new Date().toISOString() });
});
