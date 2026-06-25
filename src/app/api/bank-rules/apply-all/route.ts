import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { serverT } from '@/lib/server-i18n';
import { JournalEntryService } from '@/lib/services/journal-entry.service';

import {
  transactionMatchesRule,
  loadEntityFirstContext,
  evaluateWinningRule,
  loadRolePriorities,
  type Transaction,
  type Rule,
  type MatchingRule,
} from '@/lib/services/rule-matching-engine';

// ─── POST /api/bank-rules/apply-all ────────────────────────────────
// Apply ALL active rules to all unmatched transactions.
// Rules are processed in priority order (lower number = higher priority).
// First match wins per transaction.
// Body: { companyId }
export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();

  // Load entity-first context for SOCIO conflict detection
  const efCtx = await loadEntityFirstContext(companyId);

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

  // Get locale for i18n
  const locale = request.headers.get('x-locale') || 'es';

  // Read company's maxApplyTransactions cap
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { maxApplyTransactions: true },
  });
  const maxApplyCap = company?.maxApplyTransactions ?? null;

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

  const totalUnmatched = unmatchedTransactions.length;
  let warning: string | undefined;

  if (maxApplyCap !== null) {
    // Company-configured cap
    if (unmatchedTransactions.length > maxApplyCap) {
      unmatchedTransactions.length = maxApplyCap;
      warning = serverT(locale, 'bankRules.applyAllCapWarning')
        .replace('{applied}', String(maxApplyCap))
        .replace('{total}', String(totalUnmatched))
        .replace('{remaining}', String(totalUnmatched - maxApplyCap));
    }
  } else {
    // Null cap = unlimited; keep 5000 hard safety net without warning
    const MAX_SAFETY = 5000;
    if (unmatchedTransactions.length > MAX_SAFETY) {
      unmatchedTransactions.length = MAX_SAFETY;
    }
  }

  let totalMatched = 0;
  const winnerMap = new Map<string, { ruleId: string; ruleName: string; txIds: string[] }>();

  const rolePriorities = await loadRolePriorities();
  const entityContexts = await db.entityContext.findMany({
    where: { companyId },
    select: { pattern: true, role: true },
  });

  for (const tx of unmatchedTransactions) {
    const matchingRules = rules.filter((rule) =>
      transactionMatchesRule(
        tx as Transaction,
        rule as Rule,
        efCtx.knownSocioPatterns,
        efCtx.entityFirstMode,
      ),
    ) as MatchingRule[];

    if (matchingRules.length === 0) continue;

    const winner = evaluateWinningRule(
      matchingRules,
      tx as Transaction,
      companyId,
      rolePriorities,
      entityContexts,
    );
    const existing = winnerMap.get(winner.id);
    if (existing) {
      existing.txIds.push(tx.id);
    } else {
      winnerMap.set(winner.id, { ruleId: winner.id, ruleName: winner.name, txIds: [tx.id] });
    }
  }

  // Track which bank accounts' GL IDs are affected for journal entry creation
  const matchedTxIds: string[] = [];

  for (const [, entry] of winnerMap) {
    const rule = rules.find((r) => r.id === entry.ruleId);
    if (!rule) continue;

    const debitIds: string[] = [];
    const creditIds: string[] = [];

    for (const txId of entry.txIds) {
      const tx = unmatchedTransactions.find((t) => t.id === txId);
      if (!tx) continue;
      if (tx.amount < 0) debitIds.push(txId);
      else creditIds.push(txId);
    }

    if (debitIds.length > 0) {
      await db.bankTransaction.updateMany({
        where: { id: { in: debitIds } },
        data: { glAccountId: rule.debitGlAccountId || rule.glAccountId, matchedRuleId: rule.id },
      });
      matchedTxIds.push(...debitIds);
    }

    if (creditIds.length > 0) {
      await db.bankTransaction.updateMany({
        where: { id: { in: creditIds } },
        data: { glAccountId: rule.creditGlAccountId || rule.glAccountId, matchedRuleId: rule.id },
      });
      matchedTxIds.push(...creditIds);
    }

    totalMatched += entry.txIds.length;
  }

  // Create journal entries for all matched transactions, grouped by bank
  if (matchedTxIds.length > 0) {
    const matchedTxs = await db.bankTransaction.findMany({
      where: { id: { in: matchedTxIds }, glAccountId: { not: null }, journalEntryId: null },
      select: { id: true, date: true, amount: true, description: true, glAccountId: true, statementId: true },
    });

    // Group by bank account to get the bank GL account ID
    const statements = await db.bankStatement.findMany({
      where: { id: { in: [...new Set(matchedTxs.map((t) => t.statementId))] } },
      select: { id: true, bankAccountId: true },
    });
    const bankAccounts = await db.bankAccount.findMany({
      where: { id: { in: [...new Set(statements.map((s) => s.bankAccountId))] } },
      select: { id: true, glAccountId: true },
    });
    const bankGlByStatement = new Map<string, string>();
    for (const st of statements) {
      const ba = bankAccounts.find((b) => b.id === st.bankAccountId);
      if (ba) bankGlByStatement.set(st.id, ba.glAccountId);
    }

    await db.$transaction(async (tx) => {
      for (const bt of matchedTxs) {
        const bankGl = bankGlByStatement.get(bt.statementId);
        if (!bankGl || !bt.glAccountId) continue;
        await JournalEntryService.createFromBankTransaction(tx, {
          bankTxId: bt.id,
          bankTxDate: bt.date,
          bankTxAmount: Number(bt.amount),
          bankTxDescription: bt.description,
          bankGlAccountId: bankGl,
          counterpartyGlAccountId: bt.glAccountId,
          companyId,
        });
      }
    });
  }

  const matchResults = Array.from(winnerMap.values()).map((entry) => ({
    ruleId: entry.ruleId,
    ruleName: entry.ruleName,
    count: entry.txIds.length,
  }));

  const response: Record<string, unknown> = {
    success: true,
    matched: totalMatched,
    total: totalUnmatched,
    rulesApplied: matchResults,
  };
  if (warning) response.warning = warning;

  return NextResponse.json(response);
});
