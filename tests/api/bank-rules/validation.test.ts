import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/bank-rules/route';
import { NextRequest } from 'next/server';

// Mock deps (sessions, db, audit, logger, direction-validation)
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
    glAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'acc-1' }]) },
    bankRule: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'rule-1', createdAt: new Date(), updatedAt: new Date() }),
    },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ createAuditLogWithRetry: vi.fn() }));
vi.mock('@/lib/services/direction-validation', () => ({
  validateDirectionProfile: vi.fn().mockResolvedValue(undefined),
}));

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/bank-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/bank-rules — conditions[] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts empty conditions array → 201', async () => {
    const response = await POST(
      makePostRequest({
        companyId: 'c1',
        name: 'Empty conditions rule',
        conditions: [],
        transactionDirection: 'any',
        debitGlAccountId: 'acc-1',
        creditGlAccountId: 'acc-1',
        glAccountId: 'acc-1',
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(201);
  });

  it('accepts valid operator → 201', async () => {
    const response = await POST(
      makePostRequest({
        companyId: 'c1',
        name: 'Valid rule',
        conditions: [{ field: 'description', operator: 'contains', value: 'WALMART' }],
        transactionDirection: 'any',
        debitGlAccountId: 'acc-1',
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(201);
  });

  it('rejects invalid operator → 400', async () => {
    const response = await POST(
      makePostRequest({
        companyId: 'c1',
        name: 'Invalid op',
        conditions: [{ field: 'description', operator: 'invalid_op', value: 'test' }],
        transactionDirection: 'any',
        debitGlAccountId: 'acc-1',
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('condition operator must be one of');
  });

  it('rejects empty value after trim → 400', async () => {
    const response = await POST(
      makePostRequest({
        companyId: 'c1',
        name: 'Empty value',
        conditions: [{ field: 'description', operator: 'contains', value: '   ' }],
        transactionDirection: 'any',
        debitGlAccountId: 'acc-1',
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('condition value cannot be empty');
  });

  it('accepts multiple conditions → 201', async () => {
    const response = await POST(
      makePostRequest({
        companyId: 'c1',
        name: 'Multi-condition rule',
        conditions: [
          { field: 'description', operator: 'contains', value: 'WALMART' },
          { field: 'description', operator: 'equals', value: 'TARGET' },
        ],
        transactionDirection: 'any',
        debitGlAccountId: 'acc-1',
        creditGlAccountId: 'acc-1',
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(201);
  });

  it('persists valid intent values on create', async () => {
    const response = await POST(
      makePostRequest({
        companyId: 'c1',
        name: 'Intent rule',
        conditions: [{ field: 'description', operator: 'contains', value: 'RENT' }],
        transactionDirection: 'any',
        debitGlAccountId: 'acc-1',
        intent: 'RENT_PAYMENT',
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(201);
    expect(db.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ intent: 'RENT_PAYMENT' }),
      }),
    );
  });

  it('rejects invalid intent values before Prisma create', async () => {
    const response = await POST(
      makePostRequest({
        companyId: 'c1',
        name: 'Invalid intent rule',
        conditions: [{ field: 'description', operator: 'contains', value: 'RENT' }],
        transactionDirection: 'any',
        debitGlAccountId: 'acc-1',
        intent: '',
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(400);
    expect(db.bankRule.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/bank-rules — entity context audit exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.bankRule.findMany).mockResolvedValue([
      {
        id: 'rule-1',
        companyId: 'c1',
        name: 'Other merchant rule',
        conditionType: 'contains',
        conditionValue: 'OTHER MERCHANT',
        transactionDirection: 'any',
        priority: 10,
        isActive: true,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
        glAccount: { id: 'acc-1', code: '5000', name: 'Expenses', accountType: 'expense' },
        entityContext: {
          id: 'entity-context-1',
          userDescription: 'Seasonal local market purchase',
          role: 'OTRO',
          pattern: 'OTHER MERCHANT',
        },
        _count: { transactions: 3 },
      },
    ] as never);
  });

  it('includes linked entityContext.userDescription in list responses without a BankRule description field', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/bank-rules?companyId=c1'),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        entityContext: {
          id: 'entity-context-1',
          userDescription: 'Seasonal local market purchase',
          role: 'OTRO',
          pattern: 'OTHER MERCHANT',
        },
      }),
    );
    expect(body.data[0]).not.toHaveProperty('userDescription');
    expect(db.bankRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          entityContext: {
            select: { id: true, userDescription: true, role: true, pattern: true },
          },
        }),
      }),
    );
  });

  it('includes linked entityContext.userDescription in paginated list responses', async () => {
    vi.mocked(db.bankRule.count).mockResolvedValue(1 as never);

    const response = await GET(
      new NextRequest('http://localhost:3000/api/bank-rules?companyId=c1&page=1&limit=10'),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].entityContext.userDescription).toBe('Seasonal local market purchase');
    expect(body.pagination.total).toBe(1);
  });
});
