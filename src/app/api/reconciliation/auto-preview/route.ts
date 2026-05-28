import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

// Helper: check if a transaction matches a rule
function transactionMatchesRule(
  tx: { description: string; amount: number },
  rule: {
    conditionType: string;
    conditionValue: string;
    transactionDirection: string;
  },
): boolean {
  if (rule.transactionDirection === 'debit' && tx.amount >= 0) return false;
  if (rule.transactionDirection === 'credit' && tx.amount < 0) return false;

  const desc = tx.description.toLowerCase();
  const val = rule.conditionValue.toLowerCase();

  switch (rule.conditionType) {
    case 'contains':
      return desc.includes(val);
    case 'starts_with':
      return desc.startsWith(val);
    case 'ends_with':
      return desc.endsWith(val);
    case 'equals':
      return desc === val;
    case 'amount_greater':
      return Math.abs(tx.amount) > Number(rule.conditionValue);
    case 'amount_less':
      return Math.abs(tx.amount) < Number(rule.conditionValue);
    default:
      return false;
  }
}

// ─── POST /api/reconciliation/auto-preview ─────────────────────────────────
// Preview auto-reconcile using bank rules + amount matching without making changes.
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { companyId, bankAccountId, matchByAmount = true } = body;

    if (!companyId || !bankAccountId) {
      return NextResponse.json(
        { error: 'companyId and bankAccountId are required' },
        { status: 400 },
      );
    }

    // Verify access
    const membership = await db.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify bank account
    const bankAccount = await db.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
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
      });
    }

    // ── Step 1: Match by rules ──
    const matchedTxIds = new Set<string>();

    for (const rule of rules) {
      for (const tx of unreconciledTransactions) {
        if (matchedTxIds.has(tx.id)) continue;
        if (transactionMatchesRule(tx, rule)) {
          matchedTxIds.add(tx.id);
        }
      }
    }

    let matchedByRule = matchedTxIds.size;
    let matchedByAmount = 0;

    // ── Step 2: Match by amount with journal entries ──
    if (matchByAmount && unreconciledTransactions.length > matchedTxIds.size) {
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

      const journalEntryMap = new Map<string, { amount: number; date: string }>();

      for (const jl of journalLines) {
        const existing = journalEntryMap.get(jl.entryId);
        const net = jl.debit - jl.credit;
        if (existing) {
          existing.amount += net;
        } else {
          journalEntryMap.set(jl.entryId, {
            amount: net,
            date: jl.entry.date.toISOString().split('T')[0],
          });
        }
      }

      for (const tx of unreconciledTransactions) {
        if (matchedTxIds.has(tx.id)) continue;

        const txDate = tx.date.toISOString().split('T')[0];
        const txAmount = tx.amount;

        for (const [entryId, jeInfo] of journalEntryMap) {
          if (Math.abs(jeInfo.amount - txAmount) < 0.01 && jeInfo.date === txDate) {
            matchedTxIds.add(tx.id);
            matchedByAmount++;
            journalEntryMap.delete(entryId);
            break;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      matched: matchedTxIds.size,
      total: unreconciledTransactions.length,
      matchedByRule,
      matchedByAmount,
    });
  } catch (error) {
    console.error('[AUTO PREVIEW ERROR]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
