import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { validateRequest } from '@/lib/validate-request';
import { createAuditLogWithRetry } from '@/lib/audit';
import { createReconciliationSchema } from '@/lib/validations/reconciliation';
import { NotFoundError, ValidationError } from '@/lib/api-error';
import { ReconciliationService } from '@/services/reconciliation.service';
import { requireCompanyContext } from '@/lib/context-storage';

// ─── GET /api/reconciliation ───────────────────────────────────────
// Get reconciliation data for a bank account with filters.
export const GET = apiHandler(async (request: NextRequest) => {
  const { userId, companyId } = requireCompanyContext();

  const { searchParams } = new URL(request.url);
  const bankAccountId = searchParams.get('bankAccountId');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const statusFilter = searchParams.get('status') || 'unreconciled'; // all | unreconciled | reconciled
  const search = searchParams.get('search');
  const statementId = searchParams.get('statementId');

  if (!bankAccountId) {
    throw new ValidationError('bankAccountId is required');
  }

  // Get bank account with GL account info
  const bankAccount = await db.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
    include: {
      glAccount: {
        select: { id: true, code: true, name: true, accountType: true, normalBalance: true },
      },
    },
  });

  if (!bankAccount) {
    throw new NotFoundError('Bank account not found');
  }

  // Get latest statement (closing balance)
  const latestStatement = await db.bankStatement.findFirst({
    where: { bankAccountId },
    orderBy: { endDate: 'desc' },
    select: { id: true, endDate: true, closingBalance: true },
  });

  // Get all statements for this bank account
  const statements = await db.bankStatement.findMany({
    where: { bankAccountId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      openingBalance: true,
      closingBalance: true,
      format: true,
      fileName: true,
    },
    orderBy: { startDate: 'desc' },
  });
  const statementIds = statements.map((s) => s.id);

  // Build transaction query with filters
  const txWhere: Record<string, unknown> = {
    statementId: { in: statementIds },
  };

  // Status filter
  if (statusFilter === 'unreconciled') {
    txWhere.isReconciled = false;
  } else if (statusFilter === 'reconciled') {
    txWhere.isReconciled = true;
  }

  // Statement filter
  if (statementId) {
    txWhere.statementId = statementId;
  }

  // Date range filter
  if (startDate || endDate) {
    txWhere.date = {};
    if (startDate)
      (txWhere.date as Record<string, unknown>).gte = new Date(startDate + 'T00:00:00.000Z');
    if (endDate)
      (txWhere.date as Record<string, unknown>).lte = new Date(endDate + 'T23:59:59.999Z');
  }

  // Search filter
  if (search) {
    txWhere.OR = [{ description: { contains: search } }, { reference: { contains: search } }];
  }

  // Get transactions (optionally paginated if cursor or limit are requested)
  const cursorParam = searchParams.get('cursor');
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50)) : null;

  let transactions;
  let nextCursor: string | null = null;
  let hasMore = false;

  if (limit) {
    transactions = await db.bankTransaction.findMany({
      where: txWhere,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      cursor: cursorParam ? { id: cursorParam } : undefined,
      skip: cursorParam ? 1 : undefined,
      include: {
        glAccount: {
          select: { id: true, code: true, name: true },
        },
        matchedRule: {
          select: { id: true, name: true },
        },
        reconciliationPeriod: {
          select: { id: true, startedAt: true, completedAt: true },
        },
      },
    });

    hasMore = transactions.length > limit;
    if (hasMore) {
      transactions.pop();
    }
    nextCursor = hasMore ? transactions[transactions.length - 1].id : null;
  } else {
    // Original behavior: get all transactions for matching/export
    transactions = await db.bankTransaction.findMany({
      where: txWhere,
      orderBy: { date: 'asc' },
      include: {
        glAccount: {
          select: { id: true, code: true, name: true },
        },
        matchedRule: {
          select: { id: true, name: true },
        },
        reconciliationPeriod: {
          select: { id: true, startedAt: true, completedAt: true },
        },
      },
    });
  }

  // Get overall counts (all statements, no date/search filter)
  const reconciledCount = await db.bankTransaction.count({
    where: { statementId: { in: statementIds }, isReconciled: true },
  });
  const totalTransactions = await db.bankTransaction.count({
    where: { statementId: { in: statementIds } },
  });

  // Calculate book balance from GL account journal lines
  const journalLines = await db.journalLine.findMany({
    where: {
      glAccountId: bankAccount.glAccountId,
      entry: { companyId, status: 'posted' },
    },
    include: { entry: { select: { date: true } } },
  });

  let bookBalance = 0;
  const isDebitNormal = bankAccount.glAccount.normalBalance === 'debit';
  for (const line of journalLines) {
    if (isDebitNormal) {
      bookBalance += line.debit - line.credit;
    } else {
      bookBalance += line.credit - line.debit;
    }
  }

  // Statement balance
  const statementBalance = latestStatement?.closingBalance ?? bankAccount.balance;
  const difference = statementBalance - bookBalance;

  // Categorize transactions
  const deposits = transactions.filter((tx) => tx.amount > 0);
  const payments = transactions.filter((tx) => tx.amount < 0);

  const depositsTotal = deposits.reduce((sum, tx) => sum + tx.amount, 0);
  const paymentsTotal = payments.reduce((sum, tx) => sum + tx.amount, 0);

  // Get current open reconciliation period
  const openPeriod = await db.reconciliationPeriod.findFirst({
    where: { bankAccountId, companyId, status: 'open' },
  });

  // Get recent completed periods (last 5)
  const recentPeriods = await db.reconciliationPeriod.findMany({
    where: { bankAccountId, companyId, status: 'completed' },
    orderBy: { completedAt: 'desc' },
    take: 5,
    include: {
      user: { select: { firstName: true, lastName: true } },
    },
  });

  return NextResponse.json({
    bankAccount: {
      id: bankAccount.id,
      accountName: bankAccount.accountName,
      bankName: bankAccount.bankName,
      balance: bankAccount.balance,
      currency: bankAccount.currency,
      glAccount: bankAccount.glAccount,
    },
    latestStatement: latestStatement
      ? { ...latestStatement, endDate: latestStatement.endDate.toISOString() }
      : null,
    statements: statements.map((s) => ({
      ...s,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
    })),
    openPeriod,
    recentPeriods: recentPeriods.map((p) => ({
      ...p,
      startedAt: p.startedAt.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
    })),
    summary: {
      statementBalance,
      bookBalance,
      difference,
      totalTransactions,
      reconciledCount,
      unreconciledCount: totalTransactions - reconciledCount,
      depositsTotal,
      paymentsTotal,
      filteredCount: transactions.length,
    },
    deposits: deposits.map((tx) => ({
      ...tx,
      date: tx.date.toISOString(),
      createdAt: tx.createdAt.toISOString(),
      reconciledAt: tx.reconciledAt?.toISOString() ?? null,
    })),
    payments: payments.map((tx) => ({
      ...tx,
      date: tx.date.toISOString(),
      createdAt: tx.createdAt.toISOString(),
      reconciledAt: tx.reconciledAt?.toISOString() ?? null,
    })),
    nextCursor,
    hasMore,
  });
});

// ─── POST /api/reconciliation ──────────────────────────────────────
// Reconcile transactions. Sets isReconciled=true and updates glAccountId.
export const POST = apiHandler(async (request: NextRequest) => {
  const { userId, companyId } = requireCompanyContext();

  const body = await validateRequest(request, createReconciliationSchema);
  if (body instanceof NextResponse) return body;
  const { bankAccountId, periodId } = body;

  const { reconciledCount, journalEntriesCreated, warnings } =
    await ReconciliationService.reconcile(body);

  // Audit log
  await createAuditLogWithRetry({
    companyId,
    userId,
    action: 'reconcile_transactions',
    entity: 'BankTransaction',
    details: JSON.stringify({
      bankAccountId,
      count: reconciledCount,
      journalEntriesCreated,
      periodId,
    }),
  });

  return NextResponse.json({
    success: true,
    reconciled: reconciledCount,
    journalEntriesCreated,
    warnings,
  });
});
