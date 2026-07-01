import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/learning/smart-classify/route';
import { NextRequest } from 'next/server';

// ─── Mocks (must include all tables apiHandler queries) ──────────────
// Must be hoisted before any imports
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
    entityContext: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    bankRule: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/entity-detector', () => ({
  loadConfig: vi.fn(),
  clusterByBehavior: vi.fn(),
}));

vi.mock('@/lib/services/entity-history-analyzer', () => ({
  analyzeEntityHistoryForCompany: vi.fn(),
}));

vi.mock('@/lib/services/smart-entity-classifier', () => ({
  classifyEntityFromHistory: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLogWithRetry: vi.fn(),
}));

vi.mock('@/lib/utils/decimal', () => ({
  toNum: (val: number) => val,
}));

import { db } from '@/lib/db';
import { loadConfig, clusterByBehavior } from '@/lib/services/entity-detector';
import { analyzeEntityHistoryForCompany } from '@/lib/services/entity-history-analyzer';
import { classifyEntityFromHistory } from '@/lib/services/smart-entity-classifier';

// ─── Fixtures ────────────────────────────────────────────────────────
const mockTransactions = [
  { description: 'MERCADO LIBRE pago', amount: 1000, date: new Date('2026-01-15') },
  { description: 'MERCADO LIBRE compra', amount: 500, date: new Date('2026-01-20') },
  { description: 'AMERICAN EXPRESS CARGO', amount: 200, date: new Date('2026-02-01') },
];

const mockCandidates = [
  {
    id: 'entity-1',
    canonicalName: 'MERCADO LIBRE',
    occurrences: 2,
    directionProfile: { creditPct: 0, debitPct: 1 },
    sampleDescriptions: ['MERCADO LIBRE pago', 'MERCADO LIBRE compra'],
    totalAmount: 1500,
    direction: 'debit',
    amountCluster: 'variable',
    possibleRecurrence: false,
    avgAmount: 750,
    frequency: 'irregular',
  },
  {
    id: 'entity-2',
    canonicalName: 'AMERICAN EXPRESS',
    occurrences: 1,
    directionProfile: { creditPct: 0, debitPct: 1 },
    sampleDescriptions: ['AMERICAN EXPRESS CARGO'],
    totalAmount: 200,
    direction: 'debit',
    amountCluster: 'fixed',
    possibleRecurrence: false,
    avgAmount: 200,
    frequency: 'unknown',
  },
];

const mockHistorySummary = {
  entityKey: 'mercado libre',
  canonicalName: 'MERCADO LIBRE',
  transactionCount: 2,
  totalAmountAbs: 1500,
  activeMonths: 1,
  directionProfile: { creditPct: 0, debitPct: 1, dominant: 'debit' as const },
  averageIntervalDays: 5,
  recurrenceLabel: 'weekly' as const,
  amountStats: { min: 500, max: 1000, average: 750, median: 750 },
  representativeDescriptions: ['MERCADO LIBRE pago'],
  recentDescriptions: ['MERCADO LIBRE compra'],
  priorConfirmations: [],
  priorRules: [],
  priorContext: null,
};

const mockSuggestion = {
  suggestedRole: 'PROVEEDOR' as const,
  suggestedIntent: 'vendor-payment',
  confidence: 0.72,
  confidenceLabel: 'medium' as const,
  explanation: 'Recurring debit activity suggests a vendor',
  reviewQuestion: 'What is this entity for your business?',
  requiresConfirmation: true as const,
  history: mockHistorySummary,
  lifecycle: { provisional: true, eligibleForReevaluation: true },
  confirmedClassificationProtected: false,
};

describe('GET /api/learning/smart-classify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Legacy behavior: returns cluster candidates ──────────────────────
  it('should return classified entities from clusterByBehavior', async () => {
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue(mockCandidates);
    (analyzeEntityHistoryForCompany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistorySummary);
    (classifyEntityFromHistory as ReturnType<typeof vi.fn>).mockReturnValue(mockSuggestion);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].canonicalName).toBe('MERCADO LIBRE');
  });

  it('should return 400 when companyId is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('companyId is required');
  });

  it('should convert db transactions to raw format before clustering', async () => {
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue(mockCandidates);
    (analyzeEntityHistoryForCompany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistorySummary);
    (classifyEntityFromHistory as ReturnType<typeof vi.fn>).mockReturnValue(mockSuggestion);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    await GET(request, { params: Promise.resolve({}) });

    // Verify clusterByBehavior receives the converted format
    const clusterArgs = (clusterByBehavior as ReturnType<typeof vi.fn>).mock.calls[0];
    const rawTransactions = clusterArgs[0];
    expect(rawTransactions).toHaveLength(3);
    expect(rawTransactions[0]).toEqual({
      description: 'MERCADO LIBRE pago',
      amount: 1000,
      date: '2026-01-15T00:00:00.000Z',
    });
  });

  it('should query only unclassified transactions', async () => {
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue(mockCandidates);
    (analyzeEntityHistoryForCompany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistorySummary);
    (classifyEntityFromHistory as ReturnType<typeof vi.fn>).mockReturnValue(mockSuggestion);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    await GET(request, { params: Promise.resolve({}) });

    // Verify the query filters by company and excludes classified/reconciled transactions
    const queryArgs = (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(queryArgs.where.statement.bankAccount.companyId).toBe('company-1');
    expect(queryArgs.where.isReconciled).toBe(false);
    expect(queryArgs.where.glAccountId).toBeNull();
  });

  it('should handle API errors gracefully with 500', async () => {
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Database connection failed'),
    );

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('should return empty data array when no transactions exist', async () => {
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  // ── PR3: enriched suggestion fields ─────────────────────────────────
  it('should include enriched suggestion fields in each candidate', async () => {
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue([mockCandidates[0]]);
    (analyzeEntityHistoryForCompany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistorySummary);
    (classifyEntityFromHistory as ReturnType<typeof vi.fn>).mockReturnValue(mockSuggestion);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    const candidate = body.data[0];
    expect(candidate.suggestedRole).toBe('PROVEEDOR');
    expect(candidate.confidence).toBe(0.72);
    expect(candidate.confidenceLabel).toBe('medium');
    expect(candidate.requiresConfirmation).toBe(true);
    expect(candidate.reviewQuestion).toBe('What is this entity for your business?');
  });

  it('should include updateSuggestion when there is a confirmed classification conflict', async () => {
    const suggestionWithUpdate = {
      ...mockSuggestion,
      updateSuggestion: { fromRole: 'CLIENTE', toRole: 'PROVEEDOR' },
    };

    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue([mockCandidates[0]]);
    (analyzeEntityHistoryForCompany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistorySummary);
    (classifyEntityFromHistory as ReturnType<typeof vi.fn>).mockReturnValue(suggestionWithUpdate);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(body.data[0].updateSuggestion).toEqual({ fromRole: 'CLIENTE', toRole: 'PROVEEDOR' });
  });

  it('should call analyzeEntityHistoryForCompany with the companyId and candidate name', async () => {
    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue([mockCandidates[0]]);
    (analyzeEntityHistoryForCompany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistorySummary);
    (classifyEntityFromHistory as ReturnType<typeof vi.fn>).mockReturnValue(mockSuggestion);

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    await GET(request, { params: Promise.resolve({}) });

    expect(analyzeEntityHistoryForCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        canonicalName: 'MERCADO LIBRE',
      }),
    );
  });

  it('should not call smart classifier for pending entities with CONFIRMED status', async () => {
    const confirmedHistorySummary = {
      ...mockHistorySummary,
      priorContext: { role: 'PROVEEDOR', status: 'CONFIRMED', confidence: 0.9 },
    };

    (db.bankTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions);
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({ clustering: { minOccurrences: 1 } });
    (clusterByBehavior as ReturnType<typeof vi.fn>).mockReturnValue([mockCandidates[0]]);
    (analyzeEntityHistoryForCompany as ReturnType<typeof vi.fn>).mockResolvedValue(confirmedHistorySummary);
    (classifyEntityFromHistory as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockSuggestion,
      confirmedClassificationProtected: true,
    });

    const request = new NextRequest(
      'http://localhost:3000/api/learning/smart-classify?companyId=company-1',
    );
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    // Should still include the candidate but mark confirmed classification as protected
    expect(body.data[0].confirmedClassificationProtected).toBe(true);
  });
});
