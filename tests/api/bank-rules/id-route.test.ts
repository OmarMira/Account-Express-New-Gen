import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock factories (before vi.mock hoisting) ──────────────

const { bankRuleUpdateMock, bankRuleFindFirstMock, glAccountFindManyMock, validateDirectionProfileMock } =
  vi.hoisted(() => ({
    bankRuleUpdateMock: vi.fn(),
    bankRuleFindFirstMock: vi.fn(),
    glAccountFindManyMock: vi.fn(),
    validateDirectionProfileMock: vi.fn().mockResolvedValue(undefined),
  }));

// ─── Shared mocks ──────────────────────────────────────────────────

vi.mock('@/lib/sessions', () => ({
  getSessionUserId: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('@/lib/context-storage', () => ({
  requireCompanyContext: vi.fn().mockReturnValue({ userId: 'user-1', companyId: 'c1' }),
  getRequestContext: vi.fn().mockReturnValue({ userId: 'user-1', companyId: 'c1' }),
  requestContext: { run: vi.fn((_ctx: unknown, fn: () => unknown) => fn()) },
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', role: 'company_admin' }) },
    companyMember: {
      findUnique: vi.fn().mockResolvedValue({ id: 'member-1', userId: 'user-1', companyId: 'c1' }),
    },
    glAccount: { findMany: glAccountFindManyMock },
    bankRule: {
      findFirst: bankRuleFindFirstMock,
      update: bankRuleUpdateMock,
    },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ createAuditLogWithRetry: vi.fn() }));
vi.mock('@/lib/services/direction-validation', () => ({
  validateDirectionProfile: validateDirectionProfileMock,
}));
vi.mock('@/lib/server-i18n', () => ({
  serverT: vi.fn((_locale: string, _key: string) => 'Translation mock'),
}));

// ─── Imports after mocks ───────────────────────────────────────────

import { PUT } from '@/app/api/bank-rules/[id]/route';
import { NextRequest } from 'next/server';

// ─── Helpers ───────────────────────────────────────────────────────

const EXISTING_RULE = {
  id: 'rule-1',
  companyId: 'c1',
  name: 'Original Rule',
  conditionType: 'contains',
  conditionValue: 'original',
  transactionDirection: 'any',
  glAccountId: 'acc-1',
  debitGlAccountId: null,
  creditGlAccountId: null,
  priority: 10,
  isActive: true,
  isManuallyEdited: false,
  entityContextId: null,
  conditions: [{ field: 'description', operator: 'contains', value: 'original' }],
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

function makePutRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/bank-rules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ═══════════════════════════════════════════════════════════════════
// PUT /api/bank-rules/[id] — isManuallyEdited
// ═══════════════════════════════════════════════════════════════════

describe('PUT /api/bank-rules/[id] — isManuallyEdited', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // First findFirst returns the existing rule; subsequent calls return null (no duplicate)
    bankRuleFindFirstMock.mockResolvedValueOnce(EXISTING_RULE).mockResolvedValue(null);
    glAccountFindManyMock.mockResolvedValue([]);
    bankRuleUpdateMock.mockImplementation(
      (args: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({
          ...EXISTING_RULE,
          ...args.data,
          updatedAt: new Date(),
          glAccount: { id: 'acc-1', code: '4010', name: 'Test GL', accountType: 'revenue' },
          debitGlAccount: null,
          creditGlAccount: null,
          _count: { transactions: 0 },
        }),
    );
  });

  it('sets isManuallyEdited=true when changing a non-isActive field (4.8)', async () => {
    const req = makePutRequest('rule-1', { companyId: 'c1', name: 'Updated Name' });
    const res = await PUT(req, { params: Promise.resolve({ id: 'rule-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isManuallyEdited).toBe(true);

    expect(bankRuleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rule-1' },
        data: expect.objectContaining({ isManuallyEdited: true }),
      }),
    );
  });

  it('leaves isManuallyEdited=false when toggling only isActive (4.9)', async () => {
    const req = makePutRequest('rule-1', { companyId: 'c1', isActive: false });
    const res = await PUT(req, { params: Promise.resolve({ id: 'rule-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isManuallyEdited).toBe(false);

    const updateCall = bankRuleUpdateMock.mock.calls[0][0];
    expect(updateCall.data.isManuallyEdited).toBeUndefined();
  });

  it('sets isManuallyEdited=true when changing priority', async () => {
    const req = makePutRequest('rule-1', { companyId: 'c1', priority: 15 });
    const res = await PUT(req, { params: Promise.resolve({ id: 'rule-1' }) });

    expect(res.status).toBe(200);
    expect(bankRuleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isManuallyEdited: true }),
      }),
    );
  });

  it('sets isManuallyEdited=true when changing transactionDirection', async () => {
    const req = makePutRequest('rule-1', { companyId: 'c1', transactionDirection: 'debit' });
    const res = await PUT(req, { params: Promise.resolve({ id: 'rule-1' }) });

    expect(res.status).toBe(200);
    expect(bankRuleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isManuallyEdited: true }),
      }),
    );
  });
});
