import { db } from '@/lib/db';
import { parseCSV } from '@/lib/csv-parser';
import { parseOFX } from '@/lib/ofx-parser';
import { parsePDFAsync } from '@/lib/pdf-processor';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  BankAccountRequiredError,
} from '@/lib/api-error';
import { trackPDFParseDuration } from '@/lib/metrics';
import { withTiming } from '@/lib/timing';
import { generateImportHash } from '@/lib/accounting/import-hash';
import { toStatementMonth, toDateString } from '@/lib/accounting/date-window';

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
        const pdfStart = performance.now();
        const parsed = await parsePDFAsync(buffer);
        trackPDFParseDuration(fileName, performance.now() - pdfStart);
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
        openingBalance || 0,
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
        parsed.openingBalance || 0,
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
    openingBalance: number = 0,
    currency: string = 'USD',
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

    // Si no existe, lanzamos un error que pre-rellenará el modal de creación
    throw new BankAccountRequiredError({
      bankName: bankName || 'Cuenta Bancaria Importada',
      accountNo: accountNumber || null,
      openingBalance,
      currency,
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

    const bankAccount = await db.bankAccount.findFirst({
      where: { id: bankAccountId },
      select: { accountNo: true },
    });
    const accountNumber = bankAccount?.accountNo || 'unknown';
    const statementMonth = toStatementMonth(startDate);

    // ─── Validar statement duplicado ANTES de insertar ───────────────
    const existingStatement = await db.bankStatement.findFirst({
      where: { bankAccountId, startDate, endDate },
    });
    if (existingStatement) {
      throw new ConflictError(
        `Statement for period ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} was already imported on ${existingStatement.createdAt.toISOString().split('T')[0]}`,
      );
    }

    // ─── Deduplicación por importHash (SHA-256) ───────────────────────
    // Detecta reimportaciones del mismo extracto sin cargar todo en memoria.
    const hashList = sorted.map((txn) =>
      generateImportHash({
        companyId,
        accountNumber,
        statementMonth,
        txDate: toDateString(txn.date),
        amount: txn.amount,
        description: txn.description,
      }),
    );

    const existingHashes = await db.bankTransaction.findMany({
      where: { importHash: { in: hashList } },
      select: { importHash: true },
    });
    const existingHashSet = new Set(existingHashes.map((t) => t.importHash));

    const uniqueTransactions = sorted.filter((_txn, idx) => !existingHashSet.has(hashList[idx]));
    const uniqueHashes = hashList.filter((_, idx) => !existingHashSet.has(hashList[idx]));

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

      const transactionsToInsert = uniqueTransactions.map((txn, idx) => {
        const { matchedRuleId, glAccountId } = this.applyBankRule(
          txn.description,
          txn.amount,
          bankRules,
        );

        if (matchedRuleId) autoCategorizedCount++;

        return {
          statementId: statement.id,
          date: txn.date,
          description: txn.description,
          amount: txn.amount,
          reference: txn.reference || null,
          isReconciled: false,
          glAccountId: glAccountId || null,
          matchedRuleId: matchedRuleId || null,
          importHash: uniqueHashes[idx], // SHA-256 para idempotencia
        };
      });

      await tx.bankTransaction.createMany({
        data: transactionsToInsert,
      });

      await ImportService.recalculateBalances(tx, bankAccountId);

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

  public static async recalculateBalances(tx: any, bankAccountId: string) {
    const statements = await tx.bankStatement.findMany({
      where: { bankAccountId },
      orderBy: [{ startDate: 'asc' }, { endDate: 'asc' }],
    });

    if (statements.length === 0) return;

    const oldest = statements[0];
    const newest = statements[statements.length - 1];

    await tx.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        initialBalance: oldest.openingBalance,
        balance: newest.closingBalance,
      },
    });
  }
}
