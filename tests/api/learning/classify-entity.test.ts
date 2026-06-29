import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    glAccount: { findFirst: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    bankTransaction: { findMany: vi.fn() },
    entityContext: { findMany: vi.fn() },
    bankRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) =>
      cb({
        bankRule: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
      }),
    ),
  },
}));

vi.mock('@/lib/services/entity-detector', () => ({
  loadConfig: vi.fn(),
  clusterCandidates: vi.fn(),
  extractComponents: vi.fn(),
}));

vi.mock('@/lib/services/entity-context-service', () => ({
  saveContext: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/services/conversational-service', () => ({
  parseConversationalContext: vi.fn(),
}));

vi.mock('@/lib/services/audit-service', () => ({
  safeAuditLog: vi.fn(),
}));

vi.mock('@/lib/api-handler', () => ({
  apiHandler: vi.fn((handler: (...args: unknown[]) => unknown) => handler),
}));

vi.mock('@/lib/context-storage', () => ({
  requireCompanyContext: vi.fn(() => ({ userId: 'user-1', companyId: 'comp-1' })),
}));

vi.mock('@/lib/server-i18n', () => ({
  serverT: vi.fn((locale: string, key: string) => key),
}));

// ─── Imports after mocks ──────────────────────────────────────────────

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { saveContext } from '@/lib/services/entity-context-service';
import { POST } from '@/app/api/learning/classify-entity/route';

const mockDb = db as unknown as {
  glAccount: { findFirst: ReturnType<typeof vi.fn> };
  bankTransaction: { findMany: ReturnType<typeof vi.fn> };
  bankRule: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

async function makeRequest(body: unknown): Promise<NextRequest> {
  return new NextRequest('http://localhost/api/learning/classify-entity', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/learning/classify-entity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.glAccount.findFirst.mockResolvedValue({ id: 'gl-001', code: '4010' });
    mockDb.bankTransaction.findMany.mockResolvedValue([]);
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ctx-1', pattern: 'ACME' });
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        bankRule: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'new-rule-1' }),
          update: vi.fn(),
        },
      }),
    );
  });

  it('returns 200 with valid intent value', async () => {
    const req = await makeRequest({
      pattern: 'JOHN DOE',
      role: 'INQUILINO',
      intent: 'RENT_PAYMENT',
      source: 'user',
      companyId: 'comp-1',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 200 with null intent', async () => {
    const req = await makeRequest({
      pattern: 'JOHN DOE',
      role: 'INQUILINO',
      intent: null,
      glAccountCode: '4010',
      source: 'user',
      companyId: 'comp-1',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 200 when intent is omitted', async () => {
    const req = await makeRequest({
      pattern: 'JOHN DOE',
      role: 'INQUILINO',
      source: 'user',
      companyId: 'comp-1',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 400 with invalid intent value', async () => {
    const req = await makeRequest({
      pattern: 'JOHN DOE',
      role: 'INQUILINO',
      intent: 'INVALID_INTENT',
      source: 'user',
      companyId: 'comp-1',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid intent value');
  });

  it('returns 400 with number as intent value', async () => {
    const req = await makeRequest({
      pattern: 'JOHN DOE',
      role: 'INQUILINO',
      intent: 12345,
      source: 'user',
      companyId: 'comp-1',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid intent value');
  });

  it('creates rule with intent when source is user', async () => {
    mockDb.bankTransaction.findMany.mockResolvedValue([{ amount: -100 }]);

    const req = await makeRequest({
      pattern: 'JOHN DOE',
      role: 'INQUILINO',
      intent: 'RENT_PAYMENT',
      glAccountCode: '4010',
      source: 'user',
      companyId: 'comp-1',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
