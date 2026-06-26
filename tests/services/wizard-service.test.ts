import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wizardService } from '@/lib/services/wizard-service';
import type { EntityCandidate } from '@/lib/services/entity-detector';

// ─── Mock global fetch ───────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const bankRulesResponse = {
  data: [
    {
      id: 'r1',
      conditionValue: 'MERCADO LIBRE',
      isActive: true,
    },
    {
      id: 'r2',
      conditionValue: 'WALMART',
      isActive: false,
    },
  ],
};

const creditCandidate: EntityCandidate = {
  id: 'entity-1',
  canonicalName: 'MERCADO LIBRE',
  occurrences: 5,
  directionProfile: { creditPct: 1, debitPct: 0 },
  sampleDescriptions: ['MERCADO LIBRE pago'],
  totalAmount: 5000,
  direction: 'credit',
  amountCluster: 'variable',
  avgAmount: 1000,
  frequency: 'irregular',
};

describe('WizardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── fetchEntities ──────────────────────────────────────────────────
  it('fetchEntities should GET smart-classify and return EntityCandidate[]', async () => {
    const apiResponse = { data: [creditCandidate] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(apiResponse),
    });

    const result = await wizardService.fetchEntities('company-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/learning/smart-classify?companyId=company-1'),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toEqual([creditCandidate]);
  });

  it('fetchEntities should throw when API response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Bad request' }),
    });

    await expect(wizardService.fetchEntities('company-1')).rejects.toThrow('Bad request');
  });

  it('fetchEntities should throw when data is missing from response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(wizardService.fetchEntities('company-1')).rejects.toThrow(
      'No data returned from smart-classify',
    );
  });

  // ─── suggestRoleForEntity ───────────────────────────────────────────
  it('suggestRoleForEntity should POST to suggest-role with candidate data', async () => {
    const apiResponse = { suggestedRole: 'SOCIO', confidence: 0.85, explanation: 'Match' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(apiResponse),
    });

    const result = await wizardService.suggestRoleForEntity(creditCandidate, 'company-1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/learning/suggest-role',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: expect.any(String),
      }),
    );

    // Verify the request body includes candidate fields
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.description).toBe('MERCADO LIBRE');
    expect(callBody.companyId).toBe('company-1');
    expect(callBody.directionProfile).toEqual({ creditPct: 1, debitPct: 0 });
    expect(callBody.sampleDescriptions).toEqual(['MERCADO LIBRE pago']);
    expect(callBody.occurrences).toBe(5);
    expect(callBody.totalAmount).toEqual({ min: 5000, max: 5000 });

    expect(result).toEqual(apiResponse);
  });

  it('suggestRoleForEntity should throw when API fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'AI service unavailable' }),
    });

    await expect(
      wizardService.suggestRoleForEntity(creditCandidate, 'company-1'),
    ).rejects.toThrow('AI service unavailable');
  });

  // ─── createRules ────────────────────────────────────────────────────
  it('createRules should POST each rule to bank-rules endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: 'new-rule-1' } }),
    });

    const rules = [
      {
        id: 'r1', entityId: 'e1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
        conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
        transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
        isConfirmed: true,
      },
      {
        id: 'r2', entityId: 'e2', entityName: 'AMEX', role: 'CLIENTE' as const,
        conditionType: 'contains' as const, conditionValue: 'AMEX',
        transactionDirection: 'credit' as const, debitGlAccountId: '4020', creditGlAccountId: '4020',
        isConfirmed: true,
      },
    ];

    const results = await wizardService.createRules(rules, 'company-1');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/bank-rules',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('MERCADO LIBRE'),
      }),
    );

    // Verify per-rule results are returned
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('fulfilled');
  });

  it('createRules should handle partial failures via Promise.allSettled', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'r1-created' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Duplicate rule' }),
      });

    const rules = [
      {
        id: 'r1', entityId: 'e1', entityName: 'MELI', role: 'SOCIO' as const,
        conditionType: 'contains' as const, conditionValue: 'MELI',
        transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
        isConfirmed: true,
      },
      {
        id: 'r2', entityId: 'e2', entityName: 'AMEX', role: 'CLIENTE' as const,
        conditionType: 'contains' as const, conditionValue: 'AMEX',
        transactionDirection: 'any' as const, debitGlAccountId: '4020', creditGlAccountId: '4020',
        isConfirmed: true,
      },
    ];

    const results = await wizardService.createRules(rules, 'company-1');

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
  });

  // ─── applyAll ───────────────────────────────────────────────────────
  it('applyAll should POST to bank-rules/apply-all', async () => {
    const apiResponse = { matched: 15, total: 20 };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(apiResponse),
    });

    const result = await wizardService.applyAll('company-1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/bank-rules/apply-all',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: expect.stringContaining('company-1'),
      }),
    );
    expect(result).toEqual(apiResponse);
  });

  it('applyAll should throw when API response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Apply failed' }),
    });

    await expect(wizardService.applyAll('company-1')).rejects.toThrow('Apply failed');
  });

  // ─── fetchExistingEntityNames ─────────────────────────────────────
  it('fetchExistingEntityNames should return unique entity names from existing rules', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(bankRulesResponse),
    });

    const result = await wizardService.fetchExistingEntityNames('company-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bank-rules?companyId=company-1'),
      expect.any(Object),
    );
    // Should lower-case and trim, and return unique names only
    expect(result).toEqual(['mercado libre', 'walmart']);
  });

  it('fetchExistingEntityNames should return empty array when no rules exist', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    const result = await wizardService.fetchExistingEntityNames('company-1');
    expect(result).toEqual([]);
  });

  it('fetchExistingEntityNames should return empty array on API error (graceful degradation)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    const result = await wizardService.fetchExistingEntityNames('company-1');
    expect(result).toEqual([]);
  });

  it('fetchExistingEntityNames should skip empty conditionValues', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { conditionValue: '', isActive: true },
          { conditionValue: '  ', isActive: true },
          { conditionValue: 'VALID', isActive: true },
        ],
      }),
    });

    const result = await wizardService.fetchExistingEntityNames('company-1');
    expect(result).toEqual(['valid']);
  });
});
