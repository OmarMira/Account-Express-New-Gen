import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => {
  const bankRuleFindFirst = vi.fn();
  const bankRuleCreate = vi.fn();
  const bankRuleUpdate = vi.fn();
  const bankTransactionFindMany = vi.fn().mockResolvedValue([]);

  return {
    db: {
      glAccount: { findFirst: vi.fn() },
      bankAccount: { findMany: vi.fn() },
      bankTransaction: { findMany: bankTransactionFindMany },
      entityContext: { findMany: vi.fn() },
      bankRule: {
        findMany: vi.fn(),
        findFirst: bankRuleFindFirst,
        findUnique: vi.fn(),
        create: bankRuleCreate,
        update: bankRuleUpdate,
      },
      $transaction: vi.fn((cb: (tx: unknown) => unknown) =>
        cb({
          bankRule: {
            findFirst: bankRuleFindFirst,
            create: bankRuleCreate,
            update: bankRuleUpdate,
          },
        }),
      ),
    },
  };
});

vi.mock('@/lib/services/entity-detector', () => ({
  loadConfig: vi.fn(),
  clusterCandidates: vi.fn(),
  extractComponents: vi.fn(),
}));

vi.mock('@/lib/services/entity-context-service', () => ({
  saveContext: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

// ─── Imports after mocks ──────────────────────────────────────────────

import { db } from '@/lib/db';
import { loadConfig, clusterCandidates, extractComponents } from '@/lib/services/entity-detector';
import { saveContext } from '@/lib/services/entity-context-service';
import {
  classifyEntity,
  getEntityCandidates,
  getKnownSocioPatterns,
  computeDirectionProfile,
  autoCreateRule,
  deriveRoleFromIntent,
} from '@/lib/services/entity-classifier';
import { ENTITY_ROLES, entityRoleSchema, UI_ROLES } from '@/lib/constants/entity-roles';
import type { EntityContext } from '@prisma/client';

// ─── Helpers ───────────────────────────────────────────────────────────

const mockDb = db as unknown as {
  glAccount: { findFirst: ReturnType<typeof vi.fn> };
  bankAccount: { findMany: ReturnType<typeof vi.fn> };
  bankTransaction: { findMany: ReturnType<typeof vi.fn> };
  entityContext: { findMany: ReturnType<typeof vi.fn> };
  bankRule: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function makeCandidate(overrides: Partial<EntityCandidate> = {}): EntityCandidate {
  return {
    id: 'cand-1',
    canonicalName: 'ACME CORP',
    displayName: 'ACME CORP',
    count: 5,
    totalAmount: 1500,
    avgAmount: 300,
    frequency: 5,
    firstSeen: '2026-01-01',
    lastSeen: '2026-06-01',
    hasContext: false,
    contextRole: '',
    suggestedAccountId: undefined,
    suggestedAccountCode: undefined,
    ...overrides,
  };
}

// We need the EntityCandidate type for the helper above
type EntityCandidate = {
  id: string;
  canonicalName: string;
  displayName: string;
  count: number;
  totalAmount: number;
  avgAmount: number;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  hasContext: boolean;
  contextRole: string;
  suggestedAccountId: string | undefined;
  suggestedAccountCode: string | undefined;
};

// ═══════════════════════════════════════════════════════════════════════
// classifyEntity
// ═══════════════════════════════════════════════════════════════════════

describe('classifyEntity()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls saveContext with correct params when no glAccountCode', async () => {
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ctx-1' });

    await classifyEntity({
      companyId: 'comp-1',
      pattern: 'ACME CORP',
      role: 'PROVEEDOR',
      source: 'user',
      userId: 'user-1',
    });

    expect(saveContext).toHaveBeenCalledWith({
      companyId: 'comp-1',
      pattern: 'ACME CORP',
      role: 'PROVEEDOR',
      roles: undefined,
      glAccountId: null,
      source: 'user',
      userId: 'user-1',
    });
  });

  it('resolves glAccountCode to glAccountId and passes it', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue({ id: 'gl-001', code: '4010' });
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ctx-1' });

    await classifyEntity({
      companyId: 'comp-1',
      pattern: 'WAL-MART',
      role: 'PROVEEDOR',
      glAccountCode: '4010',
    });

    expect(mockDb.glAccount.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'comp-1', code: '4010', isActive: true },
    });
    expect(saveContext).toHaveBeenCalledWith(
      expect.objectContaining({ glAccountId: 'gl-001' }),
    );
  });

  it('passes null glAccountId when glAccountCode yields no match', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue(null);
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ctx-1' });

    await classifyEntity({
      companyId: 'comp-1',
      pattern: 'UNKNOWN',
      role: 'OTRO',
      glAccountCode: '9999',
      userDescription: 'test description',
    });

    expect(saveContext).toHaveBeenCalledWith(
      expect.objectContaining({ glAccountId: null }),
    );
  });

  it('defaults source to "user" when not provided', async () => {
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ctx-1' });

    await classifyEntity({
      companyId: 'comp-1',
      pattern: 'TEST',
      role: 'CLIENTE',
    });

    expect(saveContext).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'user' }),
    );
  });

  it('forwards roles array when provided', async () => {
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ctx-1' });

    await classifyEntity({
      companyId: 'comp-1',
      pattern: 'MULTI-ROLE',
      role: 'SOCIO',
      roles: ['SOCIO', 'CLIENTE'],
    });

    expect(saveContext).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['SOCIO', 'CLIENTE'] }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getEntityCandidates
// ═══════════════════════════════════════════════════════════════════════

describe('getEntityCandidates()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no bank accounts exist', async () => {
    mockDb.bankAccount.findMany.mockResolvedValue([]);

    const result = await getEntityCandidates('comp-1');

    expect(result).toEqual([]);
    expect(mockDb.bankTransaction.findMany).not.toHaveBeenCalled();
  });

  it('returns empty array when no transactions exist', async () => {
    mockDb.bankAccount.findMany.mockResolvedValue([{ id: 'ba-1' }]);
    mockDb.bankTransaction.findMany.mockResolvedValue([]);

    const result = await getEntityCandidates('comp-1');

    expect(result).toEqual([]);
    expect(clusterCandidates).not.toHaveBeenCalled();
  });

  it('returns candidates after filtering existing contexts and rules', async () => {
    mockDb.bankAccount.findMany.mockResolvedValue([{ id: 'ba-1' }, { id: 'ba-2' }]);
    mockDb.bankTransaction.findMany.mockResolvedValue([
      { description: 'Zelle from ACME', amount: 100, date: '2026-06-01', id: 'tx-1' },
      { description: 'Zelle from WAL-MART', amount: 200, date: '2026-06-01', id: 'tx-2' },
    ]);

    const mockConfig = { rules: { anchor: { regex: '^.*$' } } };
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(mockConfig);

    const walMartCandidate = makeCandidate({
      id: 'cand-wm',
      canonicalName: 'WAL-MART',
      count: 1,
      totalAmount: 200,
    });

    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue([walMartCandidate]);

    // Existing context for ACME — prevents ACME from appearing in candidates
    mockDb.entityContext.findMany.mockResolvedValue([
      { pattern: 'acme corp', glAccount: { code: '4010' } },
    ]);

    // No rules exist — doesn't filter anything out
    mockDb.bankRule.findMany.mockResolvedValue([]);

    const result = await getEntityCandidates('comp-1');

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('WAL-MART');
    expect(result[0].hasContext).toBe(false);
  });

  it('filters out candidates that match existing rules', async () => {
    mockDb.bankAccount.findMany.mockResolvedValue([{ id: 'ba-1' }]);
    mockDb.bankTransaction.findMany.mockResolvedValue([
      { description: 'Zelle from STARBUCKS', amount: 10, date: '2026-06-01', id: 'tx-1' },
      { description: 'Zelle from MCDONALDS', amount: 20, date: '2026-06-01', id: 'tx-2' },
    ]);

    const mockConfig = { rules: { anchor: { regex: '^.*$' } } };
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(mockConfig);

    const starbucks = makeCandidate({ id: 'cand-sb', canonicalName: 'STARBUCKS' });
    const mcdonalds = makeCandidate({ id: 'cand-md', canonicalName: 'MCDONALDS' });
    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue([starbucks, mcdonalds]);

    mockDb.entityContext.findMany.mockResolvedValue([]);

    // Rule matches STARBUCKS
    mockDb.bankRule.findMany.mockResolvedValue([
      { conditionValue: 'starbucks', conditions: [] },
    ]);

    const result = await getEntityCandidates('comp-1');

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('MCDONALDS');
  });

  it('selects bank accounts with correct companyId filter', async () => {
    mockDb.bankAccount.findMany.mockResolvedValue([]);

    await getEntityCandidates('comp-specific');

    expect(mockDb.bankAccount.findMany).toHaveBeenCalledWith({
      where: { companyId: 'comp-specific', isActive: true },
      select: { id: true },
    });
  });

  it('handles candidate filtering by checking rule conditions array', async () => {
    mockDb.bankAccount.findMany.mockResolvedValue([{ id: 'ba-1' }]);
    mockDb.bankTransaction.findMany.mockResolvedValue([
      { description: 'Zelle from ACME', amount: 100, date: '2026-06-01', id: 'tx-1' },
    ]);

    const mockConfig = { rules: { anchor: { regex: '^.*$' } } };
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(mockConfig);

    const acme = makeCandidate({ id: 'cand-acme', canonicalName: 'ACME CORP' });
    (clusterCandidates as ReturnType<typeof vi.fn>).mockReturnValue([acme]);

    mockDb.entityContext.findMany.mockResolvedValue([]);

    // Rule with conditions array matching ACME
    // Note: getEntityCandidates checks if cond.value contains patternLower, not the reverse
    mockDb.bankRule.findMany.mockResolvedValue([
      { conditionValue: null, conditions: [{ field: 'description', operator: 'contains', value: 'acme corp payment' }] },
    ]);

    const result = await getEntityCandidates('comp-1');

    expect(result).toHaveLength(0);
  });
});



// ═══════════════════════════════════════════════════════════════════════
// getKnownSocioPatterns
// ═══════════════════════════════════════════════════════════════════════

describe('getKnownSocioPatterns()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns patterns for contexts with SOCIO role', async () => {
    mockDb.entityContext.findMany.mockResolvedValue([
      { pattern: 'ACME PARTNERS', role: 'SOCIO', roles: null },
      { pattern: 'WAL-MART', role: 'PROVEEDOR', roles: null },
    ]);

    const result = await getKnownSocioPatterns('comp-1');

    expect(result).toEqual(['acme partners']);
  });

  it('checks roles JSON array for SOCIO membership', async () => {
    mockDb.entityContext.findMany.mockResolvedValue([
      { pattern: 'MULTI-ROLE ENTITY', role: 'CLIENTE', roles: JSON.stringify(['SOCIO', 'CLIENTE']) },
      { pattern: 'REGULAR VENDOR', role: 'PROVEEDOR', roles: null },
    ]);

    const result = await getKnownSocioPatterns('comp-1');

    expect(result).toEqual(['multi-role entity']);
  });

  it('returns empty array when no SOCIO contexts exist', async () => {
    mockDb.entityContext.findMany.mockResolvedValue([
      { pattern: 'CLIENTE A', role: 'CLIENTE', roles: null },
      { pattern: 'PROVEEDOR B', role: 'PROVEEDOR', roles: null },
    ]);

    const result = await getKnownSocioPatterns('comp-1');

    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// computeDirectionProfile
// ═══════════════════════════════════════════════════════════════════════

describe('computeDirectionProfile()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "debit" when >80% transactions are debit (amount < 0)', async () => {
    // 90% debit, 10% credit
    const transactions = [
      { amount: -100 },
      { amount: -200 },
      { amount: -150 },
      { amount: -50 },
      { amount: -75 },
      { amount: -300 },
      { amount: -250 },
      { amount: -180 },
      { amount: -90 },
      { amount: 500 }, // 1 credit
    ];
    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await computeDirectionProfile('comp-1', 'ACME');

    expect(result).toBe('debit');
    expect(mockDb.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          statement: { bankAccount: { companyId: 'comp-1' } },
        }),
        take: 200,
      }),
    );
  });

  it('returns "credit" when >80% transactions are credit (amount > 0)', async () => {
    const transactions = [
      { amount: 100 },
      { amount: 200 },
      { amount: 150 },
      { amount: 50 },
      { amount: 75 },
      { amount: 300 },
      { amount: 250 },
      { amount: 180 },
      { amount: 90 },
      { amount: -500 }, // 1 debit
    ];
    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await computeDirectionProfile('comp-1', 'ACME');

    expect(result).toBe('credit');
  });

  it('returns "credit" at the normalized 0.8 credit threshold', async () => {
    mockDb.bankTransaction.findMany.mockResolvedValue([
      ...Array.from({ length: 8 }, () => ({ amount: 100 })),
      ...Array.from({ length: 2 }, () => ({ amount: -50 })),
    ]);

    const result = await computeDirectionProfile('comp-1', 'ACME');

    expect(result).toBe('credit');
  });

  it('returns "credit" for 12 positive and 0 negative transactions', async () => {
    mockDb.bankTransaction.findMany.mockResolvedValue(
      Array.from({ length: 12 }, () => ({ amount: 100 })),
    );

    const result = await computeDirectionProfile('comp-1', 'RENT');

    expect(result).toBe('credit');
  });

  it('returns "any" when neither debit nor credit exceeds 80% threshold', async () => {
    const transactions = [
      { amount: -100 },
      { amount: -200 },
      { amount: -150 },
      { amount: -50 },
      { amount: 75 },
      { amount: 300 },
    ];
    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await computeDirectionProfile('comp-1', 'ACME');

    expect(result).toBe('any');
  });

  it('returns "any" when no transactions match the pattern', async () => {
    mockDb.bankTransaction.findMany.mockResolvedValue([]);

    const result = await computeDirectionProfile('comp-1', 'UNKNOWN');

    expect(result).toBe('any');
  });

  it('skips zero-amount transactions in direction computation', async () => {
    // 10 debit + 10 credit + 5 zero-amount → ratios based on 20 non-zero transactions
    const transactions = [
      ...Array.from({ length: 10 }, () => ({ amount: -100 })),
      ...Array.from({ length: 10 }, () => ({ amount: 100 })),
      ...Array.from({ length: 5 }, () => ({ amount: 0 })),
    ];
    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await computeDirectionProfile('comp-1', 'ACME');

    // 50/50 split after skipping zeros
    expect(result).toBe('any');
  });

  it('returns "any" when all transactions are zero-amount', async () => {
    const transactions = [
      { amount: 0 },
      { amount: 0 },
      { amount: 0 },
    ];
    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await computeDirectionProfile('comp-1', 'ACME');

    expect(result).toBe('any');
  });

  it('computes correct ratio with mixed zero-amount and non-zero transactions', async () => {
    // 9 debit, 1 credit, 5 zero-amount → ratio = 9/10 debit (0.9 > 0.8)
    const transactions = [
      ...Array.from({ length: 9 }, () => ({ amount: -100 })),
      { amount: 100 },
      { amount: 0 },
      { amount: 0 },
      { amount: 0 },
    ];
    mockDb.bankTransaction.findMany.mockResolvedValue(transactions);

    const result = await computeDirectionProfile('comp-1', 'ACME');

    expect(result).toBe('debit');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// deriveRoleFromIntent
// ═══════════════════════════════════════════════════════════════════════

describe('deriveRoleFromIntent()', () => {
  it('preserves a valid provided role only for legacy non-intent flows', () => {
    const result = deriveRoleFromIntent(null, 'EMPLEADO');

    expect(result).toBe('EMPLEADO');
  });

  it('ignores a provided role when intent is present and derives backend truth from intent', () => {
    const result = deriveRoleFromIntent('OPERATING_EXPENSE', 'CLIENTE');

    expect(result).toBe('GASTO_OPERATIVO');
  });

  it('derives CLIENTE for customer payments and OTRO for OTHER', () => {
    expect(deriveRoleFromIntent('CUSTOMER_PAYMENT')).toBe('CLIENTE');
    expect(deriveRoleFromIntent('OTHER')).toBe('OTRO');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// autoCreateRule
// ═══════════════════════════════════════════════════════════════════════

describe('autoCreateRule()', () => {
  const mockContext = { id: 'ctx-1', pattern: 'ACME', glAccountId: 'gl-001' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips rule creation when an active rule with same entityContextId exists', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue({
      id: 'rule-1',
      entityContextId: 'ctx-1',
      isActive: true,
      pattern: 'ACME',
      glAccountId: 'gl-001',
    });

    const result = await autoCreateRule('comp-1', mockContext, 'debit');

    expect(result).toEqual({});
    expect(mockDb.bankRule.create).not.toHaveBeenCalled();
    expect(mockDb.bankRule.update).not.toHaveBeenCalled();
  });

  it('reactivates and updates an inactive rule with same entityContextId', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue({
      id: 'rule-1',
      entityContextId: 'ctx-1',
      isActive: false,
      pattern: 'OLD',
      glAccountId: 'gl_old',
    });

    const result = await autoCreateRule('comp-1', mockContext, 'debit');

    expect(result).toEqual({});
    expect(mockDb.bankRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: expect.objectContaining({
        isActive: true,
        glAccountId: 'gl-001',
        transactionDirection: 'debit',
        conditionValue: 'acme',
        conditionType: 'contains',
      }),
    });
    expect(mockDb.bankRule.create).not.toHaveBeenCalled();
  });

  it('creates a new rule when no existing rule with entityContextId exists', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    const result = await autoCreateRule('comp-1', mockContext, 'debit');

    expect(result).toEqual({});
    expect(mockDb.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'comp-1',
          conditionValue: 'acme',
          conditionType: 'contains',
          glAccountId: 'gl-001',
          transactionDirection: 'debit',
          priority: 5,
          isActive: true,
          entityContextId: 'ctx-1',
        }),
      }),
    );
  });

  it('sets name to "Auto: {pattern}" on new rules', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    await autoCreateRule('comp-1', { id: 'ctx-2', pattern: 'WAL-MART', glAccountId: 'gl-002' }, 'credit');

    expect(mockDb.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Auto: WAL-MART',
        }),
      }),
    );
  });

  it('returns warning when glAccountId is null and skips rule creation', async () => {
    const result = await autoCreateRule('comp-1', { id: 'ctx-3', pattern: 'NOGL', glAccountId: null }, 'any');

    expect(result).toEqual({ warning: 'No GL account linked — rule not created' });
    expect(mockDb.bankRule.findFirst).not.toHaveBeenCalled();
    expect(mockDb.bankRule.create).not.toHaveBeenCalled();
  });

  it('creates a new rule with intent when intent is provided', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    await autoCreateRule('comp-1', mockContext, 'debit', 'RENT_PAYMENT');

    expect(mockDb.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'comp-1',
          conditionValue: 'acme',
          intent: 'RENT_PAYMENT',
        }),
      }),
    );
  });

  it('creates a new rule with null intent when intent is not provided', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    await autoCreateRule('comp-1', mockContext, 'debit');

    expect(mockDb.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          intent: null,
        }),
      }),
    );
  });

  it('creates a new rule with null intent when intent is explicitly null', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    await autoCreateRule('comp-1', mockContext, 'debit', null);

    expect(mockDb.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          intent: null,
        }),
      }),
    );
  });

  it('updates intent on reactivated rule', async () => {
    mockDb.bankRule.findFirst.mockResolvedValue({
      id: 'rule-1',
      entityContextId: 'ctx-1',
      isActive: false,
      pattern: 'OLD',
      glAccountId: 'gl_old',
    });
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    await autoCreateRule('comp-1', mockContext, 'debit', 'LOAN_PAYMENT');

    expect(mockDb.bankRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          intent: 'LOAN_PAYMENT',
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// classifyEntity — extended (auto-create side-effect)
// ═══════════════════════════════════════════════════════════════════════

describe('classifyEntity() — auto-create side-effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { context, warning } when glAccountCode yields no match (GL not found)', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue(null);
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ctx-no-gl', pattern: 'NOGL' });

    const result =     await classifyEntity({
      companyId: 'comp-1',
      pattern: 'NOGL',
      role: 'PROVEEDOR',
      glAccountCode: '9999',
      source: 'user',
    });

    expect(result.context).toBeDefined();
    expect(result.context.id).toBe('ctx-no-gl');
    expect(result.warning).toBe('No GL account linked — rule not created');
  });

  it('happy path: saves context and creates rule with correct direction & priority=5', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue({ id: 'gl-001', code: '4010' });
    const savedCtx = { id: 'ctx-1', pattern: 'ACME', glAccountId: 'gl-001' } as EntityContext;
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue(savedCtx);
    mockDb.bankTransaction.findMany.mockResolvedValue([
      { amount: -100 },
      { amount: -200 },
      { amount: -150 },
      { amount: -50 },
      { amount: -75 },
      { amount: -300 },
      { amount: -250 },
      { amount: -180 },
      { amount: -90 },
      { amount: 500 }, // 10% credit
    ]);
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    const result = await classifyEntity({
      companyId: 'comp-1',
      pattern: 'ACME',
      role: 'PROVEEDOR',
      glAccountCode: '4010',
      source: 'user',
    });

    expect(result.context.id).toBe('ctx-1');
    expect(result.warning).toBeUndefined();
    expect(mockDb.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'comp-1',
          conditionValue: 'acme',
          conditionType: 'contains',
          glAccountId: 'gl-001',
          transactionDirection: 'debit',
          priority: 5,
          isActive: true,
          entityContextId: 'ctx-1',
        }),
      }),
    );
  });

  it('passes intent through to autoCreateRule when source is user', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue({ id: 'gl-001', code: '4010' });
    const savedCtx = { id: 'ctx-1', pattern: 'ACME', glAccountId: 'gl-001' } as EntityContext;
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue(savedCtx);
    mockDb.bankTransaction.findMany.mockResolvedValue([
      { amount: -100 },
      { amount: -200 },
      { amount: -150 },
    ]);
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    await classifyEntity({
      companyId: 'comp-1',
      pattern: 'ACME',
      role: 'PROVEEDOR',
      glAccountCode: '4010',
      source: 'user',
      intent: 'RENT_PAYMENT',
    });

    expect(mockDb.bankRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          intent: 'RENT_PAYMENT',
        }),
      }),
    );
  });

  it('DOES NOT auto-create rule when source is "ai"', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue({ id: 'gl-001', code: '4010' });
    const savedCtx = { id: 'ctx-1', pattern: 'ACME', glAccountId: 'gl-001' } as EntityContext;
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue(savedCtx);
    mockDb.bankTransaction.findMany.mockResolvedValue([{ amount: -100 }]);
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    const result = await classifyEntity({
      companyId: 'comp-1',
      pattern: 'ACME',
      role: 'PROVEEDOR',
      glAccountCode: '4010',
      source: 'ai',
      intent: 'RENT_PAYMENT',
    });

    // Context should still be saved
    expect(saveContext).toHaveBeenCalled();
    // But no rule should be auto-created
    expect(mockDb.bankRule.create).not.toHaveBeenCalled();
    expect(mockDb.bankRule.update).not.toHaveBeenCalled();
    // warning should be undefined (no autoCreateRule was called)
    expect(result.warning).toBeUndefined();
  });

  it('DOES NOT auto-create rule when source is undefined', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue({ id: 'gl-001', code: '4010' });
    const savedCtx = { id: 'ctx-1', pattern: 'ACME', glAccountId: 'gl-001' } as EntityContext;
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue(savedCtx);
    mockDb.bankTransaction.findMany.mockResolvedValue([{ amount: -100 }]);
    mockDb.bankRule.findFirst.mockResolvedValue(null);
    mockDb.bankRule.create.mockResolvedValue({ id: 'new-rule-1' });

    await classifyEntity({
      companyId: 'comp-1',
      pattern: 'ACME',
      role: 'PROVEEDOR',
      glAccountCode: '4010',
      // source intentionally omitted
    });

    // Context should still be saved (defaults to 'user' for saveContext)
    expect(saveContext).toHaveBeenCalled();
    // saveContext gets source: 'user' default, but classifyEntity's source guard
    // checks input.source directly — since it's undefined, autoCreateRule is NOT called
    expect(mockDb.bankRule.create).not.toHaveBeenCalled();
  });

  it('saves trimmed OTHER userDescription before returning the no-account warning', async () => {
    mockDb.glAccount.findFirst.mockResolvedValue(null);
    const savedCtx = { id: 'ctx-1', pattern: 'MISC', glAccountId: null } as EntityContext;
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue(savedCtx);

    const result = await classifyEntity({
      companyId: 'comp-1',
      pattern: 'MISC',
      role: 'OTRO',
      roles: ['OTRO'],
      source: 'user',
      intent: 'OTHER',
      userDescription: '  Manual context  ',
    });

    expect(saveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userDescription: 'Manual context',
        role: 'OTRO',
      }),
    );
    expect(result.warning).toBe('No GL account linked — rule not created');
    expect(mockDb.bankRule.create).not.toHaveBeenCalled();
  });

  it('requires userDescription for legacy OTRO role even when intent is not OTHER', async () => {
    const savedCtx = { id: 'ctx-1', pattern: 'MISC', glAccountId: null } as EntityContext;
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue(savedCtx);

    await expect(classifyEntity({
      companyId: 'comp-1',
      pattern: 'MISC',
      role: 'OTRO',
      roles: ['OTRO'],
      source: 'user',
      intent: 'TRANSFER',
    })).rejects.toThrow('userDescription is required when intent is OTHER or role is OTRO');
    expect(saveContext).not.toHaveBeenCalled();
  });

  it('validates against the derived role when provided role is missing', async () => {
    const savedCtx = { id: 'ctx-1', pattern: 'MISC', glAccountId: null } as EntityContext;
    (saveContext as ReturnType<typeof vi.fn>).mockResolvedValue(savedCtx);

    await expect(classifyEntity({
      companyId: 'comp-1',
      pattern: 'MISC',
      source: 'user',
      intent: 'OTHER',
      userDescription: 'derived role explanation',
    })).resolves.toMatchObject({ context: savedCtx });

    expect(saveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'OTRO',
        userDescription: 'derived role explanation',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Role enum validation
// ═══════════════════════════════════════════════════════════════════════

describe('EntityRole schema validation', () => {
  it('parses all 11 valid roles from ENTITY_ROLES', () => {
    for (const role of ENTITY_ROLES) {
      const result = entityRoleSchema.safeParse(role);
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid role value', () => {
    const result = entityRoleSchema.safeParse('INVALID_ROLE');
    expect(result.success).toBe(false);
  });

  it('rejects lowercase role value', () => {
    const result = entityRoleSchema.safeParse('proveedor');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = entityRoleSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('UI_ROLES excludes IGNORADA', () => {
    expect(UI_ROLES).not.toContain('IGNORADA');
    expect(UI_ROLES).toHaveLength(ENTITY_ROLES.length - 1);
  });

  it('contains exactly 11 roles in ENTITY_ROLES', () => {
    expect(ENTITY_ROLES).toHaveLength(11);
    expect(ENTITY_ROLES).toEqual([
      'INQUILINO',
      'PROVEEDOR',
      'SOCIO',
      'CLIENTE',
      'EMPLEADO',
      'TARJETA_CREDITO',
      'PRESTAMO',
      'GASTO_OPERATIVO',
      'INGRESO',
      'OTRO',
      'IGNORADA',
    ]);
  });
});
