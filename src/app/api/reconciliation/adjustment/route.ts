import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { recalculateBankAccountBalance } from '@/lib/reconciliation';
import { computeEntryHash, computeAuditHash } from '@/lib/journal-hash';
import { verifyCompanyAccess } from '@/lib/verify-access';
import { isDateInLockedPeriod } from '@/lib/fiscal-period';
import { toCents } from '@/lib/money';

// ─── POST /api/reconciliation/adjustment ──────────────────────────
// Create an adjusting journal entry from the reconciliation screen.
// Body: { companyId, bankAccountId, date, description, debitAccountId, creditAccountId, amount, notes? }
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      companyId,
      bankAccountId,
      date,
      description,
      debitAccountId,
      creditAccountId,
      amount,
      notes,
    } = body;

    if (!companyId || !bankAccountId || !date || !description || !debitAccountId || !creditAccountId || !amount) {
      return NextResponse.json(
        { error: 'All fields are required: companyId, bankAccountId, date, description, debitAccountId, creditAccountId, amount' },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than zero' },
        { status: 400 }
      );
    }

    // Fail-Fast: Verify access
    const access = await verifyCompanyAccess(userId, companyId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Verify bank account
    const bankAccount = await db.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
      include: { glAccount: { select: { id: true } } },
    });
    if (!bankAccount) {
      return NextResponse.json(
        { error: 'Bank account not found' },
        { status: 404 }
      );
    }

    // Check fiscal period lock
    const adjustmentDateLocked = await isDateInLockedPeriod(companyId, new Date(date));
    if (adjustmentDateLocked) {
      return NextResponse.json(
        { error: 'Cannot create adjustments in a locked fiscal period' },
        { status: 403 }
      );
    }

    // Verify GL accounts belong to company
    const [debitAccount, creditAccount] = await Promise.all([
      db.glAccount.findFirst({ where: { id: debitAccountId, companyId } }),
      db.glAccount.findFirst({ where: { id: creditAccountId, companyId } }),
    ]);

    if (!debitAccount || !creditAccount) {
      return NextResponse.json(
        { error: 'One or both GL accounts not found' },
        { status: 404 }
      );
    }

    const ref = `RECON-ADJ-${new Date().toISOString().split('T')[0]}`;

    // Create journal entry with HMAC hash in a transaction
    const entry = await db.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(date),
          description: `[Reconciliation Adjustment] ${description}`,
          reference: ref,
          status: 'posted',
          lines: {
            create: [
              {
                glAccountId: debitAccountId,
                description,
                debit: toCents(amount),
                credit: 0,
              },
              {
                glAccountId: creditAccountId,
                description,
                debit: 0,
                credit: toCents(amount),
              },
            ],
          },
        },
      });

      // HMAC hash for the journal entry
      const lastPosted = await tx.journalEntry.findFirst({
        where: {
          companyId,
          status: 'posted',
          createdAt: { lt: journalEntry.createdAt },
          hash: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { hash: true },
      });

      const entryHash = computeEntryHash({
        id: journalEntry.id,
        companyId,
        date: new Date(date).toISOString(),
        description: `[Reconciliation Adjustment] ${description}`,
        reference: ref,
        status: 'posted',
        totalDebit: toCents(amount),
        totalCredit: toCents(amount),
        previousHash: lastPosted?.hash ?? null,
      });

      await tx.journalEntry.update({
        where: { id: journalEntry.id },
        data: { hash: entryHash, previousHash: lastPosted?.hash ?? null },
      });

      return journalEntry;
    });

    // Recalculate bank account balance after adjustment
    await recalculateBankAccountBalance(bankAccountId);

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });

    const auditDetails = JSON.stringify({
      bankAccountId,
      journalEntryId: entry.id,
      debitAccountId,
      creditAccountId,
      amount,
      notes,
    });

    const createdAudit = await db.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'reconciliation_adjustment',
        entity: 'JournalEntry',
        entityId: entry.id,
        details: auditDetails,
        previousHash: lastAudit?.hash ?? null,
      },
    });

    const auditHash = computeAuditHash({
      id: createdAudit.id,
      companyId,
      userId,
      action: 'reconciliation_adjustment',
      entity: 'JournalEntry',
      entityId: entry.id,
      details: auditDetails,
      previousHash: lastAudit?.hash ?? null,
    });

    await db.auditLog.update({
      where: { id: createdAudit.id },
      data: { hash: auditHash },
    });

    return NextResponse.json({
      success: true,
      journalEntry: {
        id: entry.id,
        date: entry.date.toISOString(),
        reference: entry.reference,
        description: entry.description,
        debitAmount: amount,
        creditAmount: amount,
        debitAccount: { id: debitAccount.id, code: debitAccount.code, name: debitAccount.name },
        creditAccount: { id: creditAccount.id, code: creditAccount.code, name: creditAccount.name },
      },
    });
  } catch (error) {
    console.error('[RECONCILIATION ADJUSTMENT ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
