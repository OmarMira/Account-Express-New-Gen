import { db } from '@/lib/db';
import { parseCSV } from '@/lib/csv-parser';
import { parseOFX } from '@/lib/ofx-parser';
import { parsePDF } from '@/lib/pdf-parser';
import { ValidationError, NotFoundError } from '@/lib/api-error';

export interface ImportResult {
  statementId: string;
  transactionCount: number;
  autoCategorizedCount: number;
  duplicatesSkipped: number;
  newAccountCreated: boolean;
  bankAccountName: string;
}

export class ImportService {
  static async importFile({
    companyId,
    bankAccountId,
    fileName,
    extension,
    buffer,
    content,
  }: {
    companyId: string;
    bankAccountId: string | null;
    fileName: string;
    extension: string;
    buffer: Buffer;
    content: string;
  }): Promise<ImportResult> {
    const newAccountCreated = !bankAccountId;

    // ─── PDF parsing ──────────────────────────────────────────────────
    if (extension === 'pdf') {
      let transactions: any[] = [];
      let bankName = '';
      let accountNo: string | undefined;
      let openingBalance: number | undefined;
      let closingBalance: number | undefined;
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      try {
        const parsed = await parsePDF(buffer);
        transactions = parsed.transactions;
        bankName = parsed.bankName || this.extractBankNameFromFilename(fileName);
        accountNo = parsed.accountNo;
        openingBalance = parsed.openingBalance;
        closingBalance = parsed.closingBalance;
        startDate = parsed.startDate;
        endDate = parsed.endDate;
      } catch (parseError) {
        throw new ValidationError(
          parseError instanceof Error ? parseError.message : 'Error al parsear el archivo PDF',
        );
      }

      const bankAccount = await this.findOrCreateBankAccount(
        companyId,
        bankAccountId,
        bankName,
        transactions,
        accountNo,
      );

      const balanceInfo: any = {};
      if (startDate) balanceInfo.startDate = startDate;
      if (endDate) balanceInfo.endDate = endDate;
      if (openingBalance !== undefined) balanceInfo.openingBalance = openingBalance;
      if (closingBalance !== undefined) balanceInfo.closingBalance = closingBalance;

      const result = await this.importTransactions(
        companyId,
        bankAccount.id,
        transactions,
        'pdf',
        fileName,
        balanceInfo,
      );

      return {
        ...result,
        newAccountCreated,
        bankAccountName: bankAccount.accountName,
      };
    }

    // ─── CSV parsing ─────────────────────────────────────────────────
    if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
      let transactions: any[];
      let bankName = '';

      try {
        transactions = parseCSV(content);
        bankName = this.extractBankNameFromFilename(fileName);
      } catch (parseError) {
        throw new ValidationError(
          parseError instanceof Error ? parseError.message : 'Error al parsear el archivo CSV',
        );
      }

      const bankAccount = await this.findOrCreateBankAccount(
        companyId,
        bankAccountId,
        bankName,
        transactions,
      );

      const result = await this.importTransactions(
        companyId,
        bankAccount.id,
        transactions,
        'csv',
        fileName,
      );

      return {
        ...result,
        newAccountCreated,
        bankAccountName: bankAccount.accountName,
      };
    }

    // ─── OFX/QFX parsing ─────────────────────────────────────────────
    if (extension === 'ofx' || extension === 'qfx') {
      let parsed: any;

      try {
        parsed = parseOFX(content);
      } catch (parseError) {
        throw new ValidationError(
          parseError instanceof Error ? parseError.message : 'Error al parsear el archivo OFX/QFX',
        );
      }

      const bankName = parsed.bankName;

      const bankAccount = await this.findOrCreateBankAccount(
        companyId,
        bankAccountId,
        bankName,
        parsed.transactions,
        parsed.accountNumber,
      );

      const result = await this.importTransactions(
        companyId,
        bankAccount.id,
        parsed.transactions,
        extension as 'ofx' | 'qfx',
        fileName,
        {
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          openingBalance: parsed.openingBalance,
          closingBalance: parsed.closingBalance,
        },
      );

      return {
        ...result,
        newAccountCreated,
        bankAccountName: bankAccount.accountName,
      };
    }

    throw new ValidationError(
      `Formato de archivo no soportado: .${extension}. Los formatos soportados son: .csv, .ofx, .qfx, .pdf`,
    );
  }

  private static async findOrCreateBankAccount(
    companyId: string,
    bankAccountId: string | null,
    bankName: string,
    transactions: { description: string; amount: number }[],
    accountNumber?: string,
  ) {
    if (bankAccountId) {
      const account = await db.bankAccount.findFirst({
        where: { id: bankAccountId, companyId },
      });
      if (!account) {
        throw new NotFoundError('La cuenta bancaria especificada no existe');
      }
      return account;
    }

    if (bankName) {
      const existing = await db.bankAccount.findFirst({
        where: { companyId, bankName, isActive: true },
      });
      if (existing) return existing;
    }

    if (accountNumber) {
      const existing = await db.bankAccount.findFirst({
        where: { companyId, accountNo: accountNumber, isActive: true },
      });
      if (existing) return existing;
    }

    const cashAccount = await db.glAccount.findFirst({
      where: { companyId, code: '1010', isActive: true },
    });

    const glAccount =
      cashAccount ||
      (await db.glAccount.findFirst({
        where: { companyId, accountType: 'asset', isActive: true },
      }));

    if (!glAccount) {
      throw new ValidationError(
        'No se encontró ninguna cuenta GL de tipo Activo. Por favor cree una antes de importar.',
      );
    }

    const displayName = bankName || 'Cuenta Bancaria Importada';

    return db.bankAccount.create({
      data: {
        companyId,
        accountName: displayName,
        bankName: displayName,
        accountNo: accountNumber || null,
        glAccountId: glAccount.id,
        balance: 0,
        currency: 'USD',
        isActive: true,
      },
    });
  }

  private static async importTransactions(
    companyId: string,
    bankAccountId: string,
    transactions: { date: Date; description: string; amount: number; reference?: string }[],
    format: string,
    fileName: string,
    balanceInfo?: {
      startDate: Date;
      endDate: Date;
      openingBalance: number;
      closingBalance: number;
    },
  ) {
    if (transactions.length === 0) {
      throw new ValidationError('No hay transacciones para importar');
    }

    const sorted = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());

    const startDate = balanceInfo?.startDate || sorted[0].date;
    const endDate = balanceInfo?.endDate || sorted[sorted.length - 1].date;
    const openingBalance = balanceInfo?.openingBalance ?? 0;
    const closingBalance = balanceInfo?.closingBalance ?? 0;

    const existingStatements = await db.bankStatement.findMany({
      where: { bankAccountId },
      select: { id: true },
    });
    const existingStatementIds = existingStatements.map((s) => s.id);
    const existingTransactions = await db.bankTransaction.findMany({
      where: { statementId: { in: existingStatementIds } },
      select: { date: true, amount: true, description: true, reference: true },
    });

    const existingKeys = new Set<string>();
    for (const et of existingTransactions) {
      const key = `${et.date.toISOString().split('T')[0]}|${et.amount}|${et.description.substring(0, 30).toUpperCase()}`;
      existingKeys.add(key);
    }

    const uniqueTransactions = sorted.filter((txn) => {
      const key = `${txn.date.toISOString().split('T')[0]}|${txn.amount}|${txn.description.substring(0, 30).toUpperCase()}`;
      return !existingKeys.has(key);
    });

    const duplicatesSkipped = sorted.length - uniqueTransactions.length;

    if (uniqueTransactions.length === 0) {
      return {
        statementId: '',
        transactionCount: 0,
        autoCategorizedCount: 0,
        duplicatesSkipped,
      };
    }

    const totalCredits = uniqueTransactions
      .filter((t) => t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    const totalDebits = uniqueTransactions
      .filter((t) => t.amount < 0)
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    const bankRules = await db.bankRule.findMany({
      where: { companyId, isActive: true },
      orderBy: { priority: 'asc' },
      include: {
        glAccount: { select: { id: true } },
      },
    });

    const result = await db.$transaction(async (tx) => {
      const statement = await tx.bankStatement.create({
        data: {
          companyId,
          bankAccountId,
          startDate,
          endDate,
          openingBalance,
          closingBalance: closingBalance || openingBalance + totalCredits - totalDebits,
          totalCredits,
          totalDebits,
          format,
          fileName,
        },
      });

      let autoCategorizedCount = 0;

      for (const txn of uniqueTransactions) {
        const { matchedRuleId, glAccountId } = this.applyBankRule(
          txn.description,
          txn.amount,
          bankRules,
        );

        if (matchedRuleId) autoCategorizedCount++;

        await tx.bankTransaction.create({
          data: {
            statementId: statement.id,
            date: txn.date,
            description: txn.description,
            amount: txn.amount,
            reference: txn.reference || null,
            isReconciled: false,
            glAccountId: glAccountId || null,
            matchedRuleId: matchedRuleId || null,
          },
        });
      }

      const currentAccount = await tx.bankAccount.findUnique({
        where: { id: bankAccountId },
        select: { balance: true, createdAt: true, updatedAt: true },
      });

      const isNew =
        currentAccount &&
        (currentAccount.createdAt.getTime() === currentAccount.updatedAt.getTime() ||
          currentAccount.balance === 0);
      const netChange = Number((totalCredits - totalDebits).toFixed(2));

      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          balance: isNew
            ? Number((openingBalance + netChange).toFixed(2))
            : { increment: netChange },
        },
      });

      return { statementId: statement.id, autoCategorizedCount };
    });

    return {
      statementId: result.statementId,
      transactionCount: uniqueTransactions.length,
      autoCategorizedCount: result.autoCategorizedCount,
      duplicatesSkipped,
    };
  }

  private static applyBankRule(
    description: string,
    amount: number,
    rules: any[],
  ): { matchedRuleId: string | null; glAccountId: string | null } {
    const desc = description.toUpperCase();
    const isCredit = amount > 0;
    const isDebit = amount < 0;

    for (const rule of rules) {
      if (rule.transactionDirection === 'credit' && !isCredit) continue;
      if (rule.transactionDirection === 'debit' && !isDebit) continue;

      const condValue = rule.conditionValue.toUpperCase();

      switch (rule.conditionType) {
        case 'contains':
          if (desc.includes(condValue)) {
            return { matchedRuleId: rule.id, glAccountId: rule.glAccountId };
          }
          break;
        case 'starts_with':
          if (desc.startsWith(condValue)) {
            return { matchedRuleId: rule.id, glAccountId: rule.glAccountId };
          }
          break;
        case 'ends_with':
          if (desc.endsWith(condValue)) {
            return { matchedRuleId: rule.id, glAccountId: rule.glAccountId };
          }
          break;
        case 'equals':
          if (desc === condValue) {
            return { matchedRuleId: rule.id, glAccountId: rule.glAccountId };
          }
          break;
        case 'amount_greater':
          if (Math.abs(amount) > parseFloat(rule.conditionValue)) {
            return { matchedRuleId: rule.id, glAccountId: rule.glAccountId };
          }
          break;
        case 'amount_less':
          if (Math.abs(amount) < parseFloat(rule.conditionValue)) {
            return { matchedRuleId: rule.id, glAccountId: rule.glAccountId };
          }
          break;
      }
    }

    return { matchedRuleId: null, glAccountId: null };
  }

  private static extractBankNameFromFilename(fileName: string): string {
    const base = fileName.replace(/\.[^.]+$/, '');
    const parts = base.split(/[-_\s]+/).filter(Boolean);

    const bankKeywords = [
      'chase',
      'bank',
      'wells',
      'fargo',
      'citi',
      'america',
      'bofa',
      'hsbc',
      'paypal',
      'venmo',
      'cashapp',
    ];

    const matchingParts = parts.filter((p) =>
      bankKeywords.some((kw) => p.toLowerCase().includes(kw)),
    );

    if (matchingParts.length > 0) {
      return matchingParts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
    }

    if (parts.length > 0 && parts[0].length > 2) {
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    }

    return 'Cuenta Bancaria Importada';
  }
}
