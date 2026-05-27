import { db } from '@/lib/db';
import { ValidationError, ForbiddenError } from '@/lib/api-error';
import { CreateJournalEntryInput } from '@/lib/validations/journal';
import { withTiming } from '@/lib/timing';

export class JournalService {
  static create = withTiming(async (input: CreateJournalEntryInput) => {
    const { companyId, date, description, reference, status, lines } = input;

    if (!lines || lines.length < 2) {
      throw new ValidationError('Se requieren al menos 2 líneas de asiento contable');
    }

    // Validate balanced entry (total debits must equal total credits)
    const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      throw new ValidationError('Unbalanced journal entry. Debits must equal Credits.');
    }

    // Check if the fiscal period for the entry date is closed/locked
    const entryDate = new Date(date);
    const lockedPeriod = await db.fiscalPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: entryDate },
        endDate: { gte: entryDate },
        isLocked: true,
      },
    });

    if (lockedPeriod) {
      throw new ForbiddenError('Cannot post transactions to a closed period.');
    }

    // Verify all GL accounts belong to the company and are active
    const accountIds = lines.map((l) => l.glAccountId);
    const accounts = await db.glAccount.findMany({
      where: { id: { in: accountIds }, companyId },
    });

    if (accounts.length !== new Set(accountIds).size) {
      throw new ValidationError(
        'Una o más cuentas contables no fueron encontradas o no pertenecen a esta empresa',
      );
    }

    const inactiveAccounts = accounts.filter((a) => !a.isActive);
    if (inactiveAccounts.length > 0) {
      throw new ValidationError('Una o más cuentas contables seleccionadas están inactivas');
    }

    // Create entry with lines in a transaction
    const entry = await db.$transaction(async (tx) => {
      const newEntry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(date),
          description,
          reference: reference || null,
          status,
          lines: {
            create: lines.map((l) => ({
              glAccountId: l.glAccountId,
              description: l.description || null,
              debit: l.debit,
              credit: l.credit,
            })),
          },
        },
        include: {
          lines: {
            include: {
              glAccount: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  accountType: true,
                  normalBalance: true,
                },
              },
            },
          },
        },
      });

      return newEntry;
    });

    return entry;
  }, 'JournalService.create');
}
