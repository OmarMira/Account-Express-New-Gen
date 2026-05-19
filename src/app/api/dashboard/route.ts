import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { hasCompanyAccess } from '@/lib/auth';


// ─── GET /api/dashboard?companyId=xxx ──────────────────────────────
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const userId = getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json(
        { error: 'companyId is required' },
        { status: 400 }
      );
    }

    // Verify the user has access to this company
    const hasAccess = await hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Bank accounts summary ──
    const bankAccounts = await db.bankAccount.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        accountName: true,
        bankName: true,
        balance: true,
        currency: true,
      },
    });

    const totalBankBalance = bankAccounts.reduce((sum, a) => sum + a.balance, 0);

    // ── GL account balances by type ──
    const journalLines = await db.journalLine.findMany({
      where: {
        entry: {
          companyId,
          status: 'posted',
        },
      },
      select: {
        debit: true,
        credit: true,
        glAccount: {
          select: {
            accountType: true,
            normalBalance: true,
          },
        },
      },
    });

    // Aggregate by account type
    const typeBalances: Record<string, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      revenue: 0,
      expense: 0,
    };

    for (const line of journalLines) {
      const aType = line.glAccount.accountType;
      if (!(aType in typeBalances)) continue;

      const net = line.debit - line.credit;
      // For assets/expenses (normal debit): net debit increases balance
      // For liabilities/equity/revenue (normal credit): net credit increases balance
      if (line.glAccount.normalBalance === 'debit') {
        typeBalances[aType] += net;
      } else {
        typeBalances[aType] -= net;
      }
    }

    // ── Posted journal entries count (current period) ──
    const now = new Date();
    const currentPeriod = await db.fiscalPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });

    const postedEntries = await db.journalEntry.count({
      where: {
        companyId,
        status: 'posted',
        ...(currentPeriod && {
          date: {
            gte: currentPeriod.startDate,
            lte: currentPeriod.endDate,
          },
        }),
      },
    });

    // ── Reconciliation status ──
    const allTx = await db.bankTransaction.findMany({
      where: {
        statement: { bankAccount: { companyId } },
      },
      select: { isReconciled: true },
    });

    const reconciledCount = allTx.filter((tx) => tx.isReconciled).length;
    const unreconciledCount = allTx.filter((tx) => !tx.isReconciled).length;

    // ── Recent transactions (last 10) ──
    const recentTransactions = await db.bankTransaction.findMany({
      where: {
        statement: { bankAccount: { companyId } },
      },
      orderBy: { date: 'desc' },
      take: 10,
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        reference: true,
        isReconciled: true,
        glAccount: {
          select: { name: true },
        },
      },
    });

    // ── Fiscal period alerts ──
    const upcomingPeriods = await db.fiscalPeriod.findMany({
      where: {
        companyId,
        endDate: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
        isLocked: false,
      },
      orderBy: { endDate: 'asc' },
      select: {
        id: true,
        name: true,
        endDate: true,
      },
    });

    // ── Monthly trend (last 12 months from bank transactions) ──
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const trendTxs = await db.bankTransaction.findMany({
      where: {
        statement: { bankAccount: { companyId } },
        date: { gte: twelveMonthsAgo },
      },
      select: { date: true, amount: true },
    });

    const monthMap: Record<string, { income: number; expenses: number }> = {};
    const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    for (const tx of trendTxs) {
      const d = new Date(tx.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { income: 0, expenses: 0 };
      if (tx.amount > 0) monthMap[key].income += tx.amount;
      else monthMap[key].expenses += Math.abs(tx.amount);
    }

    const monthlyTrend = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({
        month: MONTH_NAMES[parseInt(key.split('-')[1]) - 1],
        income: Math.round(val.income * 100) / 100,
        expenses: Math.round(val.expenses * 100) / 100,
      }));

    // ── Build response ──
    const accountBalances = Object.entries(typeBalances).map(
      ([accountType, balance]) => ({
        accountType,
        balance: Math.round(balance * 100) / 100,
      })
    );

    return NextResponse.json({
      totalBankBalance: Math.round(totalBankBalance * 100) / 100,
      bankAccountCount: bankAccounts.length,
      totalAssets: Math.round(typeBalances.asset * 100) / 100,
      totalLiabilities: Math.round(typeBalances.liability * 100) / 100,
      totalEquity: Math.round(typeBalances.equity * 100) / 100,
      totalRevenue: Math.round(typeBalances.revenue * 100) / 100,
      totalExpenses: Math.round(typeBalances.expense * 100) / 100,
      postedEntries,
      reconciledCount,
      unreconciledCount,
      recentTransactions,
      accountBalances,
      monthlyTrend,
      bankAccounts: bankAccounts.map((a) => ({
        id: a.id,
        accountName: a.accountName,
        bankName: a.bankName,
        balance: Math.round(a.balance * 100) / 100,
        currency: a.currency,
      })),
      upcomingPeriodEnds: upcomingPeriods.map((p) => ({
        id: p.id,
        name: p.name,
        endDate: p.endDate.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[DASHBOARD API ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
