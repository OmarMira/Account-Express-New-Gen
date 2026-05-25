import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReconciliationService } from '@/services/reconciliation.service';
import {
  createTestCompany,
  createTestBankAccount,
  createTestGlAccount,
  createTestBankStatement,
  createTestBankTransaction,
  clearDatabase,
} from '../helpers/factories';
import { db } from '@/lib/db';

describe('ReconciliationService', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterEach(async () => {
    await clearDatabase();
  });

  it('debe conciliar una transacción bancaria marcándola y actualizando la cuenta GL asignada', async () => {
    const company = await createTestCompany();
    const cashGl = await createTestGlAccount({ companyId: company.id, code: '1010', name: 'Cash' });
    const bankAccount = await createTestBankAccount(company.id, cashGl.id);
    const statement = await createTestBankStatement(company.id, bankAccount.id);

    const bankTx = await createTestBankTransaction(company.id, statement.id, {
      date: '2025-03-03',
      amount: 1100.0,
      description: 'Zelle payment from RODRIGO OCHOA',
      reference: 'T0YKY6RCL',
    });

    const incomeGl = await createTestGlAccount({ companyId: company.id, code: '4010', name: 'Sales Revenue', accountType: 'revenue', normalBalance: 'credit' });

    const result = await ReconciliationService.reconcile({
      companyId: company.id,
      bankAccountId: bankAccount.id,
      transactions: [
        {
          id: bankTx.id,
          glAccountId: incomeGl.id,
          splits: null,
        },
      ],
      createJournalEntries: false,
    });

    expect(result.reconciledCount).toBe(1);

    const updatedTx = await db.bankTransaction.findUnique({
      where: { id: bankTx.id },
    });
    expect(updatedTx?.isReconciled).toBe(true);
    expect(updatedTx?.glAccountId).toBe(incomeGl.id);
  });

  it('debe crear un asiento contable automático cuadrado al conciliar si se solicita', async () => {
    const company = await createTestCompany();
    const cashGl = await createTestGlAccount({ companyId: company.id, code: '1010', name: 'Cash' });
    const bankAccount = await createTestBankAccount(company.id, cashGl.id);
    const statement = await createTestBankStatement(company.id, bankAccount.id);

    const bankTx = await createTestBankTransaction(company.id, statement.id, {
      date: '2025-03-03',
      amount: 1100.0, // Depósito positivo
      description: 'Zelle payment from RODRIGO OCHOA',
      reference: 'T0YKY6RCL',
    });

    const incomeGl = await createTestGlAccount({ companyId: company.id, code: '4010', name: 'Sales Revenue', accountType: 'revenue', normalBalance: 'credit' });

    const result = await ReconciliationService.reconcile({
      companyId: company.id,
      bankAccountId: bankAccount.id,
      transactions: [
        {
          id: bankTx.id,
          glAccountId: incomeGl.id,
          splits: null,
        },
      ],
      createJournalEntries: true,
    });

    expect(result.reconciledCount).toBe(1);
    expect(result.journalEntriesCreated).toBe(1);

    // Verificar que se creó el asiento en contabilidad
    const journalEntries = await db.journalEntry.findMany({
      where: { companyId: company.id },
      include: { lines: true },
    });
    expect(journalEntries).toHaveLength(1);
    expect(journalEntries[0].lines).toHaveLength(2);

    const debitLine = journalEntries[0].lines.find((l) => l.debit === 1100.0);
    const creditLine = journalEntries[0].lines.find((l) => l.credit === 1100.0);

    expect(debitLine?.glAccountId).toBe(cashGl.id); // Débito a Caja
    expect(creditLine?.glAccountId).toBe(incomeGl.id); // Crédito a Ingresos
  });
});
