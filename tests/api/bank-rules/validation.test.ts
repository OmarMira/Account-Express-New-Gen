import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/bank-rules/route';
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
