import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { assertActiveFiscalPeriod } from '@/lib/fiscal-period-guard';
import { transactionMatchesRule } from '@/lib/services/rule-matching-engine';

// ─── POST /api/reconciliation/auto ─────────────────────────────────
// Auto-reconcile using bank rules + amount matching with journal entries.
// Body: { companyId, bankAccountId, createJournalEntries?, periodId?, matchByAmount? }
export const POST = apiHandler(async (request: NextRequest) => {
  const { userId, companyId } = requireCompanyContext();

  const body = await request.json();
  const { bankAccountId, createJournalEntries = false, periodId, matchByAmount = true } = body;

  if (!bankAccountId) {
    return NextResponse.json({ error: 'bankAccountId is required' }, { status: 400 });
  }

  // Verify bank account
  const bankAccount = await db.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
    include: {
      glAccount: {
        select: { id: true, code: true, name: true, normalBalance: true },
      },
    },
  });
  if (!bankAccount) {
    return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
  }

  // Get active rules sorted by priority
  const rules = await db.bankRule.findMany({
    where: { companyId, isActive: true },
    orderBy: { priority: 'asc' },
  });

  // Get unreconciled transactions
  const statements = await db.bankStatement.findMany({
    where: { bankAccountId },
    select: { id: true },
  });
  const statementIds = statements.map((s) => s.id);

  const unreconciledTransactions = await db.bankTransaction.findMany({
    where: {
      statementId: { in: statementIds },
      isReconciled: false,
    },
  });

  if (unreconciledTransactions.length === 0) {
    return NextResponse.json({
      success: true,
      matched: 0,
      matchedByRule: 0,
      matchedByAmount: 0,
      journalEntriesCreated: 0,
      message: 'No unreconciled transactions found.',
    });
  }

  // ── Step 1: Match by rules ──
  const matchedTxIds = new Set<string>();
  const matchMap = new Map<string, { ruleId: string; ruleName: string; glAccountId: string }>();

  for (const rule of rules) {
    for (const tx of unreconciledTransactions) {
      if (matchedTxIds.has(tx.id)) continue;
      if (transactionMatchesRule(tx, rule)) {
        matchedTxIds.add(tx.id);
        matchMap.set(tx.id, {
          ruleId: rule.id,
          ruleName: rule.name,
          glAccountId: rule.glAccountId || '',
        });
      }
    }
  }

  let matchedByRule = matchedTxIds.size;
  let matchedByAmount = 0;

  // ── Step 2: Match by amount with journal entries ──
  if (matchByAmount && unreconciledTransactions.length > matchedTxIds.size) {
    // Get posted journal lines for the bank GL account
    const journalLines = await db.journalLine.findMany({
      where: {
        glAccountId: bankAccount.glAccountId,
        entry: { companyId, status: 'posted' },
      },
      include: {
        entry: {
          select: { id: true, date: true, description: true, reference: true, lines: true },
        },
      },
      orderBy: { entry: { date: 'asc' } },
    });

    // Build a map of journal entry amounts (net per entry on bank account)
    const journalEntryMap = new Map<
      string,
      { amount: number; date: string; description: string; counterGlAccountId: string }
    >();

    for (const jl of journalLines) {
      const existing = journalEntryMap.get(jl.entryId);
      const net = jl.debit - jl.credit;
      if (existing) {
        existing.amount += net;
      } else {
        // Find the counter GL account
        const counterLine = jl.entry.lines.find((l) => l.glAccountId !== bankAccount.glAccountId);
        journalEntryMap.set(jl.entryId, {
          amount: net,
          date: jl.entry.date.toISOString().split('T')[0],
          description: jl.entry.description,
          counterGlAccountId: counterLine?.glAccountId || '',
        });
      }
    }

    // Match remaining transactions by amount
    for (const tx of unreconciledTransactions) {
      if (matchedTxIds.has(tx.id)) continue;

      const txDate = tx.date.toISOString().split('T')[0];
      const txAmount = tx.amount;

      for (const [entryId, jeInfo] of journalEntryMap) {
        if (Math.abs(jeInfo.amount - txAmount) < 0.01 && jeInfo.date === txDate) {
          matchedTxIds.add(tx.id);
          matchMap.set(tx.id, {
            ruleId: '',
            ruleName: 'Amount Match',
            glAccountId: jeInfo.counterGlAccountId,
          });
          matchedByAmount++;
          journalEntryMap.delete(entryId); // Don't reuse this entry
          break;
        }
      }
    }
  }

  let journalEntriesCreated = 0;

  // Process matched transactions
  await db.$transaction(async (tx) => {
    for (const [txId, match] of matchMap) {
      const transaction = unreconciledTransactions.find((t) => t.id === txId);
      if (!transaction) continue;

      // Verify that the transaction date is in an active fiscal period
      await assertActiveFiscalPeriod(companyId, transaction.date);

      const updateData: Record<string, unknown> = {
        glAccountId: match.glAccountId,
        isReconciled: true,
        reconciledAt: new Date(),
      };

      if (match.ruleId) {
        updateData.matchedRuleId = match.ruleId;
      }
      if (periodId) {
        updateData.reconciliationPeriodId = periodId;
      }

      await tx.bankTransaction.update({
        where: { id: txId },
        data: updateData,
      });

      // Create journal entry only for rule-matched, not amount-matched (those already have entries)
      if (createJournalEntries && match.ruleId) {
        const amount = Math.abs(transaction.amount);
        const debitAccountId = transaction.amount > 0 ? bankAccount.glAccountId : match.glAccountId;
        const creditAccountId =
          transaction.amount > 0 ? match.glAccountId : bankAccount.glAccountId;

        const description = `Auto-reconcile: ${transaction.description} (Rule: ${match.ruleName})`;

        await tx.journalEntry.create({
          data: {
            companyId,
            date: transaction.date,
            description,
            status: 'posted',
            lines: {
              create: [
                { glAccountId: debitAccountId, description, debit: amount, credit: 0 },
                { glAccountId: creditAccountId, description, debit: 0, credit: amount },
              ],
            },
          },
        });
        journalEntriesCreated++;
      }
    }

    // Update period transaction count
    if (periodId) {
      const periodTxCount = await tx.bankTransaction.count({
        where: { reconciliationPeriodId: periodId },
      });
      await tx.reconciliationPeriod.update({
        where: { id: periodId },
        data: { transactionCount: periodTxCount },
      });
    }
  });

  // Audit log
  await db.auditLog.create({
    data: {
      companyId,
      userId,
      action: 'auto_reconcile',
      entity: 'BankTransaction',
      details: JSON.stringify({
        bankAccountId,
        matchedByRule,
        matchedByAmount,
        totalMatched: matchedTxIds.size,
        journalEntriesCreated,
        periodId,
      }),
    },
  });

  return NextResponse.json({
    success: true,
    matched: matchedTxIds.size,
    total: unreconciledTransactions.length,
    matchedByRule,
    matchedByAmount,
    journalEntriesCreated,
  });
});
