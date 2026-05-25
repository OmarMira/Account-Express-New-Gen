import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/api-error';
import { CreateReconciliationInput } from '@/lib/validations/reconciliation';

export class ReconciliationService {
  static async reconcile(input: CreateReconciliationInput) {
    const { companyId, bankAccountId, transactions, createJournalEntries, periodId } = input;

    // Verify bank account with GL account info
    const bankAccount = await db.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
      include: {
        glAccount: {
          select: { id: true, code: true, name: true, normalBalance: true },
        },
      },
    });
    if (!bankAccount) {
      throw new NotFoundError('Bank account not found');
    }

    let reconciledCount = 0;
    let journalEntriesCreated = 0;

    await db.$transaction(async (tx) => {
      for (const txn of transactions) {
        if (!txn.id) continue;

        const bankTx = await tx.bankTransaction.findUnique({
          where: { id: txn.id },
        });
        if (!bankTx || bankTx.isReconciled) continue;

        const updateData: Record<string, any> = {
          isReconciled: true,
          reconciledAt: new Date(),
        };

        // If splits are provided, we use the first split's GL account as the main one for the bank transaction record
        const mainGlId =
          txn.splits && txn.splits.length > 0 ? txn.splits[0].glAccountId : txn.glAccountId;

        if (mainGlId) {
          const glAccount = await tx.glAccount.findFirst({
            where: { id: mainGlId, companyId },
          });
          if (glAccount) {
            updateData.glAccountId = mainGlId;
          }
        }

        if (periodId) {
          updateData.reconciliationPeriodId = periodId;
        }

        await tx.bankTransaction.update({
          where: { id: txn.id },
          data: updateData,
        });

        // Create journal entry if requested
        if (createJournalEntries) {
          const amount = Math.abs(bankTx.amount);
          const isDeposit = bankTx.amount > 0;
          const description = `Reconciliation: ${bankTx.description}`;

          // Case 1: Splits provided
          if (txn.splits && txn.splits.length > 0) {
            const lines: any[] = [];

            // The bank side line
            lines.push({
              glAccountId: bankAccount.glAccountId,
              description,
              debit: isDeposit ? amount : 0,
              credit: isDeposit ? 0 : amount,
            });

            // The split side lines
            for (const split of txn.splits) {
              const splitAmount = Math.abs(split.amount);
              lines.push({
                glAccountId: split.glAccountId,
                description: split.description || description,
                debit: isDeposit ? 0 : splitAmount,
                credit: isDeposit ? splitAmount : 0,
              });
            }

            await tx.journalEntry.create({
              data: {
                companyId,
                date: bankTx.date,
                description,
                status: 'posted',
                lines: { create: lines },
              },
            });
            journalEntriesCreated++;
          }
          // Case 2: No splits, but glAccountId provided
          else if (mainGlId) {
            const debitAccountId = isDeposit ? bankAccount.glAccountId : mainGlId;
            const creditAccountId = isDeposit ? mainGlId : bankAccount.glAccountId;

            await tx.journalEntry.create({
              data: {
                companyId,
                date: bankTx.date,
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

        reconciledCount++;
      }

      // Update period transaction count if period provided
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

    return {
      reconciledCount,
      journalEntriesCreated,
    };
  }
}
