import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { loadConfig, clusterByBehavior } from '@/lib/services/entity-detector';
import { logger } from '@/lib/logger';
import { toNum } from '@/lib/utils/decimal';

// ─── GET /api/learning/smart-classify ─────────────────────────────────
// Dedicated endpoint that uses clusterByBehavior() for the wizard flow.
// Does NOT replace classify-entity — this is additive for the wizard only.
export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();

  try {
    // Fetch unclassified, unreconciled bank transactions for this company
    const transactions = await db.bankTransaction.findMany({
      where: {
        statement: {
          bankAccount: {
            companyId,
          },
        },
        isReconciled: false,
        glAccountId: null,
      },
      select: {
        description: true,
        amount: true,
        date: true,
      },
    });

    // Convert Prisma models to the raw format expected by clusterByBehavior
    const rawTransactions = transactions.map((t) => ({
      description: t.description,
      amount: toNum(t.amount),
      date: t.date.toISOString(),
    }));

    const config = loadConfig();
    const candidates = clusterByBehavior(rawTransactions, config);

    return NextResponse.json({ data: candidates });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    logger.error('SMART_CLASSIFY_ERROR', { error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
