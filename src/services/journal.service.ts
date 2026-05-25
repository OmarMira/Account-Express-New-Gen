import { db } from '@/lib/db';
import { ValidationError } from '@/lib/api-error';
import { CreateJournalEntryInput } from '@/lib/validations/journal';

export class JournalService {
  static async create(input: CreateJournalEntryInput) {
    const { companyId, date, description, reference, status, lines } = input;

    if (!lines || lines.length < 2) {
      throw new ValidationError('Se requieren al menos 2 líneas de asiento contable');
    }

    // Validate balanced entry (total debits must equal total credits)
    const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);

    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      throw new ValidationError(
        `El asiento contable debe estar cuadrado. El total de débitos (${totalDebits.toFixed(
          2,
        )}) debe ser igual al total de créditos (${totalCredits.toFixed(2)})`,
      );
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
  }
}
