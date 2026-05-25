import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { hasCompanyAccess } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
    }

    const hasAccess = await hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get all active bank accounts for the company
    const bankAccounts = await db.bankAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, accountName: true, bankName: true, accountNo: true },
    });

    const bankAccountIds = bankAccounts.map((a) => a.id);

    // Get all bank transactions for those bank accounts
    const transactions = await db.bankTransaction.findMany({
      where: {
        statement: {
          bankAccountId: { in: bankAccountIds },
        },
      },
      include: {
        glAccount: {
          select: {
            code: true,
            name: true,
            accountType: true,
          },
        },
        matchedRule: {
          include: {
            glAccount: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Format transactions to match dashboard requirements
    const formattedTransactions = transactions.map((t) => ({
      id: t.id,
      fecha: t.date.toISOString().split('T')[0],
      descripcion: t.description,
      monto: Math.abs(t.amount),
      tipo: t.amount > 0 ? 'credito' : 'debito',
      cuenta_contable: t.glAccount ? `${t.glAccount.code} ${t.glAccount.name}` : '',
      conciliado: t.isReconciled,
      glAccountCode: t.glAccount?.code || null,
      glAccountName: t.glAccount?.name || null,
      glAccountType: t.glAccount?.accountType || null,
      matchedRuleId: t.matchedRuleId,
      matchedRuleName: t.matchedRule?.name || null,
      matchedRuleGlAccountName: t.matchedRule?.glAccount?.name || null,
    }));

    // Query active bank rules
    const bankRules = await db.bankRule.findMany({
      where: {
        companyId,
        isActive: true,
      },
      include: {
        glAccount: {
          select: {
            code: true,
            name: true,
            accountType: true,
          },
        },
      },
      orderBy: {
        priority: 'asc',
      },
    });

    const formattedBankRules = bankRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      conditionType: rule.conditionType,
      conditionValue: rule.conditionValue,
      transactionDirection: rule.transactionDirection,
      priority: rule.priority,
      glAccountCode: rule.glAccount.code,
      glAccountName: rule.glAccount.name,
      glAccountType: rule.glAccount.accountType,
    }));

    // Sum openingBalance of the earliest statement for each active bank account
    let initialBalance = 0;
    for (const account of bankAccounts) {
      const earliestStatement = await db.bankStatement.findFirst({
        where: { bankAccountId: account.id },
        orderBy: { startDate: 'asc' },
        select: { openingBalance: true },
      });
      if (earliestStatement) {
        initialBalance += earliestStatement.openingBalance;
      }
    }

    const firstAccount = bankAccounts[0];
    const bankAccountInfo = firstAccount
      ? {
          accountName: firstAccount.accountName,
          bankName: firstAccount.bankName,
          accountNo: firstAccount.accountNo || '',
        }
      : null;

    // Calculate MoM trends based on distinct months
    const months = Array.from(
      new Set(formattedTransactions.map((t) => t.fecha.substring(0, 7))),
    ).sort();

    let revenueTrend = 0;
    let expenseTrend = 0;

    if (months.length >= 2) {
      const lastMonth = months[months.length - 1];
      const prevMonth = months[months.length - 2];

      const lastMonthCredits = formattedTransactions
        .filter((t) => t.fecha.startsWith(lastMonth) && t.tipo === 'credito')
        .reduce((s, t) => s + t.monto, 0);

      const prevMonthCredits = formattedTransactions
        .filter((t) => t.fecha.startsWith(prevMonth) && t.tipo === 'credito')
        .reduce((s, t) => s + t.monto, 0);

      const lastMonthDebits = formattedTransactions
        .filter((t) => t.fecha.startsWith(lastMonth) && t.tipo === 'debito')
        .reduce((s, t) => s + t.monto, 0);

      const prevMonthDebits = formattedTransactions
        .filter((t) => t.fecha.startsWith(prevMonth) && t.tipo === 'debito')
        .reduce((s, t) => s + t.monto, 0);

      if (prevMonthCredits > 0) {
        revenueTrend = Number(
          (((lastMonthCredits - prevMonthCredits) / prevMonthCredits) * 100).toFixed(1),
        );
      }
      if (prevMonthDebits > 0) {
        expenseTrend = Number(
          (((lastMonthDebits - prevMonthDebits) / prevMonthDebits) * 100).toFixed(1),
        );
      }
    }

    return NextResponse.json({
      transactions: formattedTransactions,
      bankAccounts,
      initialBalance,
      bankAccountInfo,
      revenueTrend,
      expenseTrend,
      bankRules: formattedBankRules,
    });
  } catch (error) {
    console.error('[FINANCIAL DASHBOARD API ERROR]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
