import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/bank-rules/apply-all/route';
import { GET as previewGET } from '@/app/api/bank-rules/apply-all/preview/route';
import {
  createTestUser,
  createTestCompany,
  createTestCompanyMember,
  createTestGlAccount,
  createTestBankAccount,
  createTestBankStatement,
  createTestBankTransaction,
  clearDatabase,
} from '../../helpers/factories';
import { createSession } from '@/lib/sessions';
import { db } from '@/lib/db';
import { JournalEntryService } from '@/lib/services/journal-entry.service';

describe('POST /api/bank-rules/apply-all — integration', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterEach(async () => {
    await clearDatabase();
  });

  async function setupSimpleScenario(txCount: number, maxApply?: number | null) {
    const user = await createTestUser('test@example.com');
    const company = await createTestCompany('Test Co');
    await createTestCompanyMember(user.id, company.id);

    if (maxApply !== undefined && maxApply !== null) {
      await db.company.update({
        where: { id: company.id },
        data: { maxApplyTransactions: maxApply },
      });
    }

    const token = await createSession(user.id);
    const glAccount = await createTestGlAccount({ companyId: company.id, code: '5000', name: 'Expense' });
    const bankAccount = await createTestBankAccount(company.id, glAccount.id, 'Test Bank');
    const statement = await createTestBankStatement(company.id, bankAccount.id);

    // Create matching rule
    await db.bankRule.create({
      data: {
        companyId: company.id,
        name: 'Amazon Rule',
        conditionType: 'contains',
        conditionValue: 'AMAZON',
        transactionDirection: 'any',
        glAccountId: glAccount.id,
        priority: 10,
      },
    });

    // Create transactions
    const date = new Date('2025-06-01');
    for (let i = 0; i < txCount; i++) {
      await createTestBankTransaction(company.id, statement.id, {
        date: '2025-06-01',
        amount: -50.0,
        description: `AMAZON PURCHASE ${i + 1}`,
      });
    }

    return { user, company, token, glAccount };
  }

  // ─── Task 5.3: Happy path integration ───────────────────

  function makePostRequest(companyId: string, token: string): NextRequest {
    return new NextRequest('http://localhost/api/bank-rules/apply-all', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companyId }),
    });
  }

  describe('Happy path (ATOMIC-SC-01)', () => {
    it('applies all 5 transactions with 1 matching rule', async () => {
      const { company, token } = await setupSimpleScenario(5);

      const res = await POST(makePostRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.matched).toBe(5);
      // Verify transactions have been matched
      const matched = await db.bankTransaction.findMany({
        where: { matchedRuleId: { not: null } },
      });
      expect(matched).toHaveLength(5);
    });
  });

  describe('Empty batch (ATOMIC-SC-04)', () => {
    it('returns matched: 0 when no pending transactions', async () => {
      const { company, token } = await setupSimpleScenario(0);

      const res = await POST(makePostRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.matched).toBe(0);
      expect(body.total).toBe(0);
    });
  });

  // ─── Task 5.4: Rollback on failure ──────────────────────

  describe('Atomic rollback (ATOMIC-SC-02)', () => {
    it('rolls back ALL mutations when journal creation throws on 3rd call', async () => {
      const { company, token, glAccount } = await setupSimpleScenario(3);

      // Stub JournalEntryService to throw on 3rd call
      let callCount = 0;
      vi.spyOn(JournalEntryService, 'createFromBankTransaction').mockImplementation(
        async () => {
          callCount++;
          if (callCount === 3) {
            throw new Error('Simulated journal creation failure');
          }
          return 'journal-entry-id';
        },
      );

      const res = await POST(makePostRequest(company.id, token), { params: Promise.resolve({}) });
      // Should throw/return 500 due to rollback
      expect(res.status).toBe(500);

      // Verify: NO transactions have matchedRuleId set (all rolled back)
      const orphanedCount = await db.bankTransaction.count({
        where: {
          matchedRuleId: { not: null },
          journalEntryId: null,
        },
      });
      expect(orphanedCount).toBe(0);

      // All transactions should still be unmatched
      const matched = await db.bankTransaction.findMany({
        where: { matchedRuleId: { not: null } },
      });
      expect(matched).toHaveLength(0);

      vi.restoreAllMocks();
    });
  });

  // ─── Task 5.7: Preview endpoint ────────────────────────

  describe('GET /api/bank-rules/apply-all/preview', () => {
    function makePreviewRequest(companyId: string, token: string): NextRequest {
      return new NextRequest(`http://localhost/api/bank-rules/apply-all/preview?companyId=${companyId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    it('returns estimated totals for pending transactions', async () => {
      const { company, token, glAccount } = await setupSimpleScenario(45);

      const res = await previewGET(makePreviewRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();

      // 45 pending transactions all matched by 1 rule
      expect(body.totalTransactions).toBe(45);
      expect(body.rulesToApply).toBe(1);
      expect(body.totalAmount).toBe(-2250); // 45 × -50
      expect(body.remaining).toBe(0);
    });

    it('returns zero totals when no active rules exist', async () => {
      const user = await createTestUser('test@example.com');
      const company = await createTestCompany('Empty Co');
      await createTestCompanyMember(user.id, company.id);
      const token = await createSession(user.id);

      // No rules created

      const res = await previewGET(makePreviewRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalTransactions).toBe(0);
      expect(body.totalAmount).toBe(0);
      expect(body.rulesToApply).toBe(0);
    });

    it('caps preview at 200 transactions (PREVIEW-SC-04)', async () => {
      const { company, token } = await setupSimpleScenario(350);

      const res = await previewGET(makePreviewRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalTransactions).toBe(200);
      expect(body.remaining).toBe(150);
    });

    it('returns zero totals for zero pending (PREVIEW-SC-05)', async () => {
      const { company, token } = await setupSimpleScenario(0);

      const res = await previewGET(makePreviewRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalTransactions).toBe(0);
      expect(body.rulesToApply).toBe(0);
      expect(body.warning).toBeNull();
    });
  });

  // ─── Task 5.5: Concurrency ──────────────────────────────

  describe('Concurrency (ATOMIC-SC-03)', () => {
    it('handles 2 parallel requests without deadlock', async () => {
      const { company, token } = await setupSimpleScenario(300);

      const [res1, res2] = await Promise.all([
        POST(makePostRequest(company.id, token), { params: Promise.resolve({}) }),
        POST(makePostRequest(company.id, token), { params: Promise.resolve({}) }),
      ]);

      // Both should succeed (no deadlock, no 500/timeout)
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    }, 15000);
  });

  // ─── Task 5.6: Batch cap integration ────────────────────

  describe('Batch cap (BATCH-SC-02, BATCH-SC-05)', () => {
    it('caps at 200 with 250 pending (no company override)', async () => {
      const { company, token } = await setupSimpleScenario(250);

      const res = await POST(makePostRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.matched).toBe(200);
      expect(body.total).toBe(250);
    });

    it('caps company override of 500 at 200', async () => {
      const { company, token } = await setupSimpleScenario(400, 500);

      const res = await POST(makePostRequest(company.id, token), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.matched).toBe(200);
    });
  });
});
