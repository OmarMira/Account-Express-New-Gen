import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { loadConfig, clusterCandidates } from '@/lib/services/entity-detector';
import { logger } from '@/lib/logger';

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();

  try {
    // Cargar transacciones no reconciliadas ni imputadas
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

    const rawTransactions = transactions.map((t) => ({
      description: t.description,
      amount: t.amount,
      date: t.date.toISOString(),
    }));

    const config = loadConfig();
    const candidates = clusterCandidates(rawTransactions, config);

    // ── Filter out entities that already have a bank rule ──────────
    const existingRules = await db.bankRule.findMany({
      where: { companyId, isActive: true },
      select: { conditionValue: true },
    });
    const ruleValues = existingRules.map((r) => r.conditionValue.toLowerCase());

    const pending = candidates.filter(
      (c) => !ruleValues.some((rv) => rv.includes(c.canonicalName.toLowerCase())),
    );

    // Ordenar por número de ocurrencias desc
    const sorted = [...pending].sort((a, b) => b.occurrences - a.occurrences);

    return NextResponse.json({ success: true, candidates: sorted });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    logger.error('GET_PENDING_ENTITIES_ERROR', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
