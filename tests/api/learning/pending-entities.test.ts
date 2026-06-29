import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/learning/pending-entities/route';
import { NextRequest } from 'next/server';

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/sessions', () => ({
  getSessionUserId: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', role: 'company_admin' }),
    },
    companyMember: {
      findUnique: vi.fn().mockResolvedValue({ id: 'member-1', userId: 'user-1', companyId: 'company-1' }),
    },
    bankTransaction: {
      findMany: vi.fn(),
    },
    bankRule: {
      findMany: vi.fn(),
    },
    entityContext: {
      findMany: vi.fn(),
    },
    detectionConfig: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/entity-detector', () => ({
  loadConfig: vi.fn().mockReturnValue({
    clustering: { minOccurrences: 1, minLength: 3, stopWords: [], threshold: 0.85 },
    validation: { minOccurrences: 1, ignorePatterns: [] },
    sanitization: { stripPatterns: [] },
    extraction: { strategies: [{ priority: 1, pattern: '^(TEST_ENTITY)\\b', description: 'Test' }] },
  }),
  clusterCandidates: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLogWithRetry: vi.fn(),
}));

// ─── Imports after mocks ───────────────────────────────────────────────────

import { db } from '@/lib/db';
import { clusterCandidates } from '@/lib/services/entity-detector';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const mockCandidates = [
  {
    id: 'cand-1',
    canonicalName: 'TEST ENTITY',
    occurrences: 3,
    directionProfile: { creditPct: 0, debitPct: 1 },
    sampleDescriptions: ['TEST ENTITY payment'],
    totalAmount: 300,
  },
  {
    id: 'cand-2',
    canonicalName: 'ANOTHER ENTITY',
    occurrences: 2,
    directionProfile: { creditPct: 1, debitPct: 0 },
    sampleDescriptions: ['ANOTHER ENTITY deposit'],
    totalAmount: 500,
  },
];

describe('GET /api/learning/pending-entities — FK coverage detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ALL entities with isCovered=false when no EntityContexts exist', async () => {
    // Setup: no transactions → no candidates (edge case handled by clusterCandidates)
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (db.bankRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/pending-entities?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.candidates).toEqual([]);
  });

  it('marks isCovered=true when an EntityContext exists with an active FK-linked BankRule', async () => {
    // Setup: EntityContext matches TEST ENTITY
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ctx-1', pattern: 'TEST ENTITY' },
    ]);

    // Active BankRule with entityContextId pointing to ctx-1
    (db.bankRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entityContextId: 'ctx-1' },
    ]);

    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { description: 'TEST ENTITY', amount: -100, date: new Date('2026-06-01') },
      { description: 'ANOTHER ENTITY', amount: 200, date: new Date('2026-06-01') },
    ]);

    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue(mockCandidates);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/pending-entities?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates[0]).toMatchObject({
      canonicalName: 'TEST ENTITY',
      isCovered: true,
    });
    expect(body.candidates[1]).toMatchObject({
      canonicalName: 'ANOTHER ENTITY',
      isCovered: false,
    });
  });

  it('marks isCovered=false when BankRule is deactivated (no FK-linked active rules)', async () => {
    // Setup: EntityContext exists but BankRule is NOT in the active-linked query
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ctx-1', pattern: 'TEST ENTITY' },
    ]);

    // Only inactive rules or rules without entityContextId
    (db.bankRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { description: 'TEST ENTITY', amount: -100, date: new Date('2026-06-01') },
    ]);

    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue(mockCandidates);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/pending-entities?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates[0]).toMatchObject({
      canonicalName: 'TEST ENTITY',
      isCovered: false,
    });
  });

  it('does NOT filter out covered entities — all entities remain visible', async () => {
    // Setup: BOTH entities have EntityContexts and rules
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ctx-1', pattern: 'TEST ENTITY' },
      { id: 'ctx-2', pattern: 'ANOTHER ENTITY' },
    ]);

    (db.bankRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entityContextId: 'ctx-1' },
      { entityContextId: 'ctx-2' },
    ]);

    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { description: 'TEST ENTITY', amount: -100, date: new Date('2026-06-01') },
      { description: 'ANOTHER ENTITY', amount: 200, date: new Date('2026-06-01') },
    ]);

    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue(mockCandidates);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/pending-entities?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates).toHaveLength(2); // ALL entities returned
    expect(body.candidates.every((c: { isCovered: boolean }) => c.isCovered === true)).toBe(true);
  });

  it('ignores BankRules with entityContextId=null (manual rules)', async () => {
    // Setup: manual rule exists but does NOT count as coverage
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ctx-1', pattern: 'TEST ENTITY' },
    ]);

    // This query filters entityContextId: { not: null }, so manual rules are excluded
    (db.bankRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { description: 'TEST ENTITY', amount: -100, date: new Date('2026-06-01') },
    ]);

    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue(mockCandidates);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/pending-entities?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates.find((c: { canonicalName: string }) => c.canonicalName === 'TEST ENTITY')?.isCovered).toBe(false);
  });

  it('sorts entities by occurrences descending', async () => {
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (db.bankRule.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { description: 'TEST ENTITY', amount: -100, date: new Date('2026-06-01') },
      { description: 'ANOTHER ENTITY', amount: 200, date: new Date('2026-06-01') },
    ]);

    // Out of order
    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue([
      { ...mockCandidates[1] },
      { ...mockCandidates[0] },
    ]);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/pending-entities?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(body.candidates[0].occurrences).toBeGreaterThanOrEqual(body.candidates[1].occurrences);
  });
});
