import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { getSessionUserId } from '@/lib/sessions';
import { db } from '@/lib/db';
import { ForbiddenError, AuthError } from '@/lib/api-error';
import { getMetricsSummary } from '@/lib/metrics';

export const GET = apiHandler(async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    throw new AuthError('Authentication required');
  }

  // Defensive role check — only super_admin can access metrics
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user || user.role !== 'super_admin') {
    throw new ForbiddenError('Metrics endpoint requires super_admin role');
  }

  return NextResponse.json(getMetricsSummary());
});
