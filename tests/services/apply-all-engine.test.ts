import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mocked } from 'vitest';

// Mock db — apply-all-engine uses db for read-only matching queries
vi.mock('@/lib/db', () => ({
  db: {
    bankRule: {
      findMany: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    bankStatement: {
      findMany: vi.fn(),
    },
    bankTransaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    entityContext: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('@/lib/services/rule-matching-engine', () => ({
  loadEntityFirstContext: vi.fn().mockResolvedValue({
    knownSocioPatterns: [],
    entityFirstMode: false,
  }),
  transactionMatchesRule: vi.fn(),
  evaluateWinningRule: vi.fn(),
  loadRolePriorities: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/services/journal-entry.service', () => ({
  JournalEntryService: {
    createFromBankTransaction: vi.fn().mockResolvedValue('journal-entry-1'),
  },
}));

import { db } from '@/lib/db';
import { loadEntityFirstContext, transactionMatchesRule, evaluateWinningRule, loadRolePriorities } from '@/lib/services/rule-matching-engine';
import { JournalEntryService } from '@/lib/services/journal-entry.service';
import { matchTransactions, executeApplyAll } from '@/lib/services/apply-all-engine';
import type { MatchResult } from '@/lib/services/apply-all-engine';

const mockDb = db as Mocked<typeof db>;

const RULE_ID_1 = 'rule-1';
const RULE_ID_2 = 'rule-2';
const COMPANY_ID = 'company-1';
const STATEMENT_ID = 'statement-1';

beforeEach(() => {
  vi.clearAllMocks();

  // Default: 1 active rule
  mockDb.bankRule.findMany.mockResolvedValue([
    { id: RULE_ID_1, name: 'Amazon Rule', priority: 10, isActive: true,
      glAccountId: 'gl-1', debitGlAccountId: null, creditGlAccountId: null,
      companyId: COMPANY_ID, conditions: [{ field: 'description', operator: 'contains', value: 'AMAZON' }],
      conditionType: null, conditionValue: null, transactionDirection: 'any',
      createdAt: new Date(), updatedAt: new Date() },
  ]);

  mockDb.company.findUnique.mockResolvedValue({ maxApplyTransactions: null });
  mockDb.bankStatement.findMany.mockResolvedValue([{ id: STATEMENT_ID }]);
  mockDb.bankTransaction.findMany.mockResolvedValue([]);

  // Default matching: first rule matches
  vi.mocked(transactionMatchesRule).mockReturnValue(true);
  vi.mocked(evaluateWinningRule).mockImplementation((rules) => rules[0]);
});

// ─── Task 5.1: matchTransactions unit tests ───────────────

describe('matchTransactions', () => {
  it('returns empty result when no active rules exist', async () => {
    mockDb.bankRule.findMany.mockResolvedValue([]);

    const result = await matchTransactions(COMPANY_ID);
    expect(result.matchedRules).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.remaining).toBe(0);
    // Should NOT have queried transactions if no rules
    expect(mockDb.bankTransaction.findMany).not.toHaveBeenCalled();
  });

  it('returns empty when rules exist but no pending transactions', async () => {
    mockDb.bankTransaction.findMany.mockResolvedValue([]);

    const result = await matchTransactions(COMPANY_ID);
    expect(result.matchedRules).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.totalAmount).toBe(0);
  });

  it('returns up to 200 transactions by default (MAX_PER_BATCH)', async () => {
    const transactions = Array.from({ length: 300 }, (_, i) => ({
      id: `tx-${i}`,
      statementId: STATEMENT_ID,
      amount: -100.0,
      description: `AMAZON PURCHASE ${i}`,
      date: new Date('2025-06-01'),
      isReconciled: false,
      matchedRuleId: null,
      glAccountId: null,
      reference: null,
      journalEntryId: null,
      companyId: COMPANY_ID,
    }));

    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await matchTransactions(COMPANY_ID);

    // 200 is the max, even with 300 pending
    expect(result.totalCount).toBe(200);
    expect(result.totalAmount).toBe(-20000);
    expect(result.remaining).toBe(100);
  });

  it('returns correct totalAmount from matched transactions', async () => {
    const transactions = [
      { id: 'tx-1', statementId: STATEMENT_ID, amount: -150.0, description: 'AMAZON PURCHASE',
        date: new Date(), isReconciled: false, matchedRuleId: null, glAccountId: null,
        reference: null, journalEntryId: null, companyId: COMPANY_ID },
      { id: 'tx-2', statementId: STATEMENT_ID, amount: -200.0, description: 'AMAZON PURCHASE 2',
        date: new Date(), isReconciled: false, matchedRuleId: null, glAccountId: null,
        reference: null, journalEntryId: null, companyId: COMPANY_ID },
      { id: 'tx-3', statementId: STATEMENT_ID, amount: 350.0, description: 'REFUND',
        date: new Date(), isReconciled: false, matchedRuleId: null, glAccountId: null,
        reference: null, journalEntryId: null, companyId: COMPANY_ID },
    ];

    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await matchTransactions(COMPANY_ID);

    expect(result.totalCount).toBe(3);
    expect(result.totalAmount).toBe(0); // -150 - 200 + 350 = 0
    expect(result.matchedRules).toHaveLength(1);
  });

  it('respects custom limit option below 200', async () => {
    const transactions = Array.from({ length: 50 }, (_, i) => ({
      id: `tx-${i}`, statementId: STATEMENT_ID, amount: -100.0,
      description: `AMAZON ${i}`, date: new Date(), isReconciled: false,
      matchedRuleId: null, glAccountId: null,
      reference: null, journalEntryId: null, companyId: COMPANY_ID,
    }));

    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);
    mockDb.company.findUnique.mockResolvedValue({ maxApplyTransactions: 30 });

    const result = await matchTransactions(COMPANY_ID, { limit: 30 });
    expect(result.totalCount).toBe(30);
    expect(result.remaining).toBe(20);
  });

  it('caps company override above 200 at MAX_PER_BATCH', async () => {
    const transactions = Array.from({ length: 400 }, (_, i) => ({
      id: `tx-${i}`, statementId: STATEMENT_ID, amount: -100.0,
      description: `AMAZON ${i}`, date: new Date(), isReconciled: false,
      matchedRuleId: null, glAccountId: null,
      reference: null, journalEntryId: null, companyId: COMPANY_ID,
    }));

    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);
    mockDb.company.findUnique.mockResolvedValue({ maxApplyTransactions: 500 });

    const result = await matchTransactions(COMPANY_ID);
    expect(result.totalCount).toBe(200); // capped at 200
    expect(result.remaining).toBe(200);
  });
});

// ─── Task 5.2: executeApplyAll unit tests ────────────────

describe('executeApplyAll', () => {
  const mockTxClient = {
    bankTransaction: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    bankStatement: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    bankAccount: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  const baseMatchResult: MatchResult = {
    matchedRules: [{
      rule: { id: RULE_ID_1, name: 'Amazon Rule', priority: 10 },
      txIds: ['tx-debit-1', 'tx-debit-2', 'tx-credit-1'],
    }],
    transactions: [
      { id: 'tx-debit-1', amount: -100, description: 'AMZ1' },
      { id: 'tx-debit-2', amount: -200, description: 'AMZ2' },
      { id: 'tx-credit-1', amount: 150, description: 'REFUND' },
    ],
    totalAmount: -150,
    totalCount: 3,
    remaining: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTxClient.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-debit-1', date: new Date(), amount: -100, description: 'AMZ1', glAccountId: 'gl-1', statementId: STATEMENT_ID },
      { id: 'tx-debit-2', date: new Date(), amount: -200, description: 'AMZ2', glAccountId: 'gl-1', statementId: STATEMENT_ID },
      { id: 'tx-credit-1', date: new Date(), amount: 150, description: 'REFUND', glAccountId: 'gl-2', statementId: STATEMENT_ID },
    ]);
  });

  it('calls updateMany with correct debit IDs first, then credit IDs', async () => {
    mockTxClient.bankTransaction.updateMany.mockResolvedValue({ count: 1 });
    mockTxClient.bankTransaction.findMany.mockResolvedValue([]);

    await executeApplyAll(COMPANY_ID, mockTxClient as any, baseMatchResult);

    // First call should be debits (tx-debit-1, tx-debit-2)
    expect(mockTxClient.bankTransaction.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ['tx-debit-1', 'tx-debit-2'] } },
      data: expect.objectContaining({ matchedRuleId: RULE_ID_1 }),
    });

    // Second call should be credits (tx-credit-1)
    expect(mockTxClient.bankTransaction.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['tx-credit-1'] } },
      data: expect.objectContaining({ matchedRuleId: RULE_ID_1 }),
    });
  });

  it('sorts IDs ascending within debit and credit groups', async () => {
    const matchResult: MatchResult = {
      matchedRules: [{
        rule: { id: RULE_ID_1, name: 'Rule', priority: 10 },
        txIds: ['tx-3', 'tx-1', 'tx-2'],
      }],
      transactions: [
        { id: 'tx-1', amount: -100, description: 'A' },
        { id: 'tx-2', amount: -100, description: 'B' },
        { id: 'tx-3', amount: -100, description: 'C' },
      ],
      totalAmount: -300,
      totalCount: 3,
      remaining: 0,
    };

    mockTxClient.bankTransaction.updateMany.mockResolvedValue({ count: 1 });
    mockTxClient.bankTransaction.findMany.mockResolvedValue([]);

    await executeApplyAll(COMPANY_ID, mockTxClient as any, matchResult);

    expect(mockTxClient.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tx-1', 'tx-2', 'tx-3'] } },
      data: expect.any(Object),
    });
  });

  it('calls JournalEntryService.createFromBankTransaction for each matched transaction', async () => {
    mockTxClient.bankTransaction.updateMany.mockResolvedValue({ count: 1 });
    mockTxClient.bankTransaction.findMany.mockResolvedValue([
      { id: 'tx-debit-1', date: new Date('2025-06-01'), amount: -100, description: 'AMZ1', glAccountId: 'gl-1', statementId: STATEMENT_ID },
      { id: 'tx-debit-2', date: new Date('2025-06-02'), amount: -200, description: 'AMZ2', glAccountId: 'gl-1', statementId: STATEMENT_ID },
    ]);
    mockTxClient.bankStatement.findMany.mockResolvedValue([
      { id: STATEMENT_ID, bankAccountId: 'ba-1' },
    ]);
    mockTxClient.bankAccount.findMany.mockResolvedValue([
      { id: 'ba-1', glAccountId: 'bank-gl-1' },
    ]);

    const result = await executeApplyAll(COMPANY_ID, mockTxClient as any, {
      ...baseMatchResult,
      matchedRules: [{
        rule: { id: RULE_ID_1, name: 'Amazon Rule', priority: 10 },
        txIds: ['tx-debit-1', 'tx-debit-2'],
      }],
      transactions: [
        { id: 'tx-debit-1', amount: -100, description: 'AMZ1' },
        { id: 'tx-debit-2', amount: -200, description: 'AMZ2' },
      ],
      totalCount: 2,
    });

    expect(JournalEntryService.createFromBankTransaction).toHaveBeenCalledTimes(2);
    expect(result.appliedCount).toBe(2);
    expect(result.journalEntryCount).toBe(2);
  });

  it('uses tx client for re-fetch, not db client', async () => {
    mockTxClient.bankTransaction.updateMany.mockResolvedValue({ count: 1 });
    mockTxClient.bankTransaction.findMany.mockResolvedValue([]);

    await executeApplyAll(COMPANY_ID, mockTxClient as any, baseMatchResult);

    // The re-fetch uses tx.bankTransaction.findMany, not db.bankTransaction.findMany
    expect(mockTxClient.bankTransaction.findMany).toHaveBeenCalled();
  });
});
