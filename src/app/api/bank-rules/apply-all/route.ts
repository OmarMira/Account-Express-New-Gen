import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';

import { transactionMatchesRule } from '@/lib/services/rule-matching-engine';

// ─── POST /api/bank-rules/apply-all ────────────────────────────────
// Apply ALL active rules to all unmatched transactions.
// Rules are processed in priority order (lower number = higher priority).
// First match wins per transaction.
// Body: { companyId }
export const POST = apiHandler(async (request: NextRequest, context: { params: any }) => {
  const { userId, companyId } = requireCompanyContext();

  // Get all active rules sorted by priority
  const rules = await db.bankRule.findMany({
    where: { companyId, isActive: true },
    orderBy: { priority: 'asc' },
  });

  if (rules.length === 0) {
    return NextResponse.json({
      success: true,
      matched: 0,
      total: 0,
      message: 'No active rules found.',
    });
  }

  // Get all unmatched transactions for this company
  const companyStatements = await db.bankStatement.findMany({
    where: { companyId },
    select: { id: true },
  });
  const statementIds = companyStatements.map((s) => s.id);

  const unmatchedTransactions = await db.bankTransaction.findMany({
    where: {
      statementId: { in: statementIds },
      isReconciled: false,
      matchedRuleId: null,
    },
  });

  let totalMatched = 0;
  const matchResults: { ruleId: string; ruleName: string; count: number }[] = [];

  // Track which transactions have been matched
  const matchedTxIds = new Set<string>();

  // Process each rule in priority order
  for (const rule of rules) {
    const txsForThisRule = unmatchedTransactions.filter(
      (tx) => !matchedTxIds.has(tx.id) && transactionMatchesRule(tx, rule),
    );

    if (txsForThisRule.length > 0) {
      const txIds = txsForThisRule.map((tx) => tx.id);
      await db.bankTransaction.updateMany({
        where: { id: { in: txIds } },
        data: {
          glAccountId: rule.glAccountId,
          matchedRuleId: rule.id,
        },
      });

      txIds.forEach((tid) => matchedTxIds.add(tid));
      totalMatched += txIds.length;
      matchResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        count: txIds.length,
      });
    }
  }

  return NextResponse.json({
    success: true,
    matched: totalMatched,
    total: unmatchedTransactions.length,
    rulesApplied: matchResults,
  });
});
