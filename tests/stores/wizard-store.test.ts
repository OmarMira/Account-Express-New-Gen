import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWizardStore } from '@/lib/stores/wizard-store';
import type { EntityCandidate } from '@/lib/services/entity-detector';

// ─── Mock external dependencies ──────────────────────────────────────
vi.mock('@/lib/services/wizard-service', () => ({
  wizardService: {
    fetchEntities: vi.fn(),
    fetchExistingEntityNames: vi.fn(),
    suggestRoleForEntity: vi.fn(),
    createRules: vi.fn(),
    applyAll: vi.fn(),
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────
const creditCandidate: EntityCandidate = {
  id: 'entity-1',
  canonicalName: 'MERCADO LIBRE',
  occurrences: 5,
  directionProfile: { creditPct: 1, debitPct: 0 },
  sampleDescriptions: ['MERCADO LIBRE pago', 'MERCADO LIBRE compra'],
  totalAmount: 5000,
  direction: 'credit',
  amountCluster: 'variable',
  avgAmount: 1000,
  frequency: 'irregular',
};

const debitCandidate: EntityCandidate = {
  id: 'entity-2',
  canonicalName: 'AMERICAN EXPRESS',
  occurrences: 3,
  directionProfile: { creditPct: 0, debitPct: 1 },
  sampleDescriptions: ['AMERICAN EXPRESS pago'],
  totalAmount: 3000,
  direction: 'debit',
  amountCluster: 'fixed',
  avgAmount: 1000,
  frequency: 'monthly',
};

describe('WizardStore', () => {
  beforeEach(() => {
    useWizardStore.setState({
      open: false,
      step: 1,
      entities: [],
      entitiesLoading: false,
      entitiesError: null,
      proposedRules: [],
      executionStatus: 'idle',
      executionError: null,
      affectedTransactions: 0,
      createdRules: 0,
      stepError: null,
    });
    vi.clearAllMocks();
  });

  // ─── openWizard ──────────────────────────────────────────────────────
  it('openWizard should set open to true and step to 1', () => {
    useWizardStore.getState().openWizard();
    const state = useWizardStore.getState();
    expect(state.open).toBe(true);
    expect(state.step).toBe(1);
  });

  // ─── closeWizard + reset ────────────────────────────────────────────
  it('closeWizard should reset all state and set open to false', () => {
    // Set up a non-default state as if user was mid-flow
    useWizardStore.setState({
      open: true,
      step: 3,
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
      ],
      proposedRules: [
        {
          id: 'r1', entityId: 'entity-1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: true,
        },
      ],
      executionStatus: 'done' as const,
      executionError: null,
      affectedTransactions: 10,
      createdRules: 5,
    });

    useWizardStore.getState().closeWizard();
    const state = useWizardStore.getState();

    expect(state.open).toBe(false);
    expect(state.step).toBe(1);
    expect(state.entities).toEqual([]);
    expect(state.proposedRules).toEqual([]);
    expect(state.executionStatus).toBe('idle');
    expect(state.affectedTransactions).toBe(0);
    expect(state.createdRules).toBe(0);
    expect(state.executionError).toBeNull();
  });

  // ─── nextStep guard 1→2 (requires ≥1 entity with role) ──────────────
  it('nextStep from 1 should stay on step 1 when no entity has an assigned role', () => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    useWizardStore.getState().nextStep();
    expect(useWizardStore.getState().step).toBe(1);
  });

  it('nextStep from 1 should advance to step 2 when at least one entity has a role', () => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
        { candidate: debitCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    useWizardStore.getState().nextStep();
    expect(useWizardStore.getState().step).toBe(2);
  });

  // ─── setEntityRole ──────────────────────────────────────────────────
  it('setEntityRole should assign role to the matching entity by id', () => {
    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
        { candidate: debitCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    useWizardStore.getState().setEntityRole('entity-1', 'SOCIO');
    const entities = useWizardStore.getState().entities;

    expect(entities[0].assignedRole).toBe('SOCIO');
    expect(entities[1].assignedRole).toBeNull();
  });

  it('setEntityRole should overwrite an existing role assignment', () => {
    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: 'CLIENTE' as const, suggestionStatus: 'pending' as const },
      ],
    });

    useWizardStore.getState().setEntityRole('entity-1', 'PROVEEDOR');
    expect(useWizardStore.getState().entities[0].assignedRole).toBe('PROVEEDOR');
  });

  // ─── nextStep guard 2→3 (requires ≥1 rule confirmed) ────────────────
  it('nextStep from 2 should stay on step 2 when no rule is confirmed', () => {
    useWizardStore.setState({
      open: true,
      step: 2,
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
      ],
      proposedRules: [
        {
          id: 'r1', entityId: 'entity-1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: false,
        },
      ],
    });

    useWizardStore.getState().nextStep();
    expect(useWizardStore.getState().step).toBe(2);
  });

  it('nextStep from 2 should advance to step 3 when at least one rule is confirmed', () => {
    useWizardStore.setState({
      open: true,
      step: 2,
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
      ],
      proposedRules: [
        {
          id: 'r1', entityId: 'entity-1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: true,
        },
      ],
    });

    useWizardStore.getState().nextStep();
    expect(useWizardStore.getState().step).toBe(3);
  });

  // ─── prevStep ───────────────────────────────────────────────────────
  it('prevStep should go from step 2 to step 1', () => {
    useWizardStore.setState({ open: true, step: 2 });
    useWizardStore.getState().prevStep();
    expect(useWizardStore.getState().step).toBe(1);
  });

  it('prevStep should go from step 3 to step 2', () => {
    useWizardStore.setState({ open: true, step: 3 });
    useWizardStore.getState().prevStep();
    expect(useWizardStore.getState().step).toBe(2);
  });

  // ─── updateRuleGlAccount ────────────────────────────────────────────
  it('updateRuleGlAccount should update debit and credit accounts for a rule by id', () => {
    useWizardStore.setState({
      proposedRules: [
        {
          id: 'r1', entityId: 'e1', entityName: 'test', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'test',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: false,
        },
      ],
    });

    useWizardStore.getState().updateRuleGlAccount('r1', '6030', '4020');
    const rule = useWizardStore.getState().proposedRules[0];
    expect(rule.debitGlAccountId).toBe('6030');
    expect(rule.creditGlAccountId).toBe('4020');
  });

  it('updateRuleGlAccount should allow null for debit account', () => {
    useWizardStore.setState({
      proposedRules: [
        {
          id: 'r1', entityId: 'e1', entityName: 'test', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'test',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: false,
        },
      ],
    });

    useWizardStore.getState().updateRuleGlAccount('r1', null, '3010');
    const rule = useWizardStore.getState().proposedRules[0];
    expect(rule.debitGlAccountId).toBeNull();
    expect(rule.creditGlAccountId).toBe('3010');
  });

  // ─── buildProposedRules ─────────────────────────────────────────────
  it('buildProposedRules should create rules from entities with assigned roles', () => {
    useWizardStore.setState({
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
        { candidate: debitCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    useWizardStore.getState().buildProposedRules();
    const rules = useWizardStore.getState().proposedRules;

    // Should create rule only for SOCIO entity, not for null-role entity
    expect(rules).toHaveLength(1);
    expect(rules[0].entityId).toBe('entity-1');
    expect(rules[0].entityName).toBe('MERCADO LIBRE');
    expect(rules[0].role).toBe('SOCIO');
    expect(rules[0].conditionType).toBe('contains');
    expect(rules[0].conditionValue).toBe('MERCADO LIBRE');
    expect(rules[0].isConfirmed).toBe(false);
    // SOCIO has debit: '3040', credit: '3010' from ROLE_ACCOUNT_MAP
    expect(rules[0].debitGlAccountId).toBe('3040');
    expect(rules[0].creditGlAccountId).toBe('3010');
  });

  it('buildProposedRules should clear previous rules before rebuilding', () => {
    useWizardStore.setState({
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
      ],
      // Pre-existing rules that should be overwritten
      proposedRules: [
        {
          id: 'old-rule', entityId: 'old', entityName: 'OLD', role: 'CLIENTE' as const,
          conditionType: 'contains' as const, conditionValue: 'OLD',
          transactionDirection: 'any' as const, debitGlAccountId: 'x', creditGlAccountId: 'y',
          isConfirmed: true,
        },
      ],
    });

    useWizardStore.getState().buildProposedRules();
    const rules = useWizardStore.getState().proposedRules;

    expect(rules).toHaveLength(1);
    expect(rules[0].entityId).toBe('entity-1');
    expect(rules[0].isConfirmed).toBe(false); // Fresh rules start unconfirmed
  });

  // ─── reset ─────────────────────────────────────────────────────────
  it('reset should clear all state to defaults with open=false', () => {
    useWizardStore.setState({
      open: true,
      step: 3,
      entitiesLoading: true,
      entitiesError: 'some error',
      executionStatus: 'error',
      executionError: 'failed',
      affectedTransactions: 10,
      createdRules: 5,
    });

    useWizardStore.getState().reset();
    const state = useWizardStore.getState();

    expect(state.open).toBe(false);
    expect(state.step).toBe(1);
    expect(state.entities).toEqual([]);
    expect(state.entitiesLoading).toBe(false);
    expect(state.entitiesError).toBeNull();
    expect(state.proposedRules).toEqual([]);
    expect(state.executionStatus).toBe('idle');
    expect(state.executionError).toBeNull();
    expect(state.affectedTransactions).toBe(0);
    expect(state.createdRules).toBe(0);
  });

  // ─── fetchEntities (async) ─────────────────────────────────────────
  it('fetchEntities should set entities from service and clear error', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    const mockEntities = [creditCandidate, debitCandidate];
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntities);
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    useWizardStore.setState({ open: true, entitiesError: 'previous error' });
    await useWizardStore.getState().fetchEntities('company-1');

    const state = useWizardStore.getState();
    expect(state.entitiesLoading).toBe(false);
    expect(state.entitiesError).toBeNull();
    expect(state.entities).toHaveLength(2);
    expect(state.entities[0].candidate.id).toBe('entity-1');
    expect(state.entities[0].assignedRole).toBeNull();
    expect(state.entities[0].suggestionStatus).toBe('pending');
    expect(state.entities[1].candidate.id).toBe('entity-2');
  });

  it('fetchEntities should set entitiesLoading true during fetch', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    let resolvePromise!: (val: EntityCandidate[]) => void;
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<EntityCandidate[]>((resolve) => { resolvePromise = resolve; }),
    );
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    useWizardStore.setState({ open: true });
    const fetchPromise = useWizardStore.getState().fetchEntities('company-1');

    expect(useWizardStore.getState().entitiesLoading).toBe(true);

    resolvePromise([creditCandidate]);
    await fetchPromise;
  });

  it('fetchEntities should set entitiesError on failure', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );

    useWizardStore.setState({ open: true });
    await useWizardStore.getState().fetchEntities('company-1');

    const state = useWizardStore.getState();
    expect(state.entitiesLoading).toBe(false);
    expect(state.entitiesError).toBe('Network error');
    expect(state.entities).toEqual([]);
  });

  // ─── nextStep auto-buildProposedRules on 1→2 ───────────────────────
  it('nextStep from 1 should call buildProposedRules before advancing to step 2', () => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
      ],
      proposedRules: [],
    });

    useWizardStore.getState().nextStep();

    const state = useWizardStore.getState();
    expect(state.step).toBe(2);
    // buildProposedRules should have created a rule from the assigned role
    expect(state.proposedRules).toHaveLength(1);
    expect(state.proposedRules[0].entityId).toBe('entity-1');
    expect(state.proposedRules[0].role).toBe('SOCIO');
    expect(state.proposedRules[0].debitGlAccountId).toBe('3040');
    expect(state.proposedRules[0].creditGlAccountId).toBe('3010');
  });

  // ─── executeApply (async) ──────────────────────────────────────────
  it('executeApply should call service createRules and applyAll on success', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.createRules as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: 'fulfilled', value: { data: { id: 'r1' } } },
      { status: 'fulfilled', value: { data: { id: 'r2' } } },
    ]);
    (wizardService.applyAll as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: 15, total: 20,
    });

    const testRules = [
      {
        id: 'r1', entityId: 'e1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
        conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
        transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
        isConfirmed: true,
      },
    ];
    useWizardStore.setState({ open: true, step: 3, proposedRules: testRules });

    await useWizardStore.getState().executeApply('company-1');

    const state = useWizardStore.getState();
    expect(wizardService.createRules).toHaveBeenCalledWith(testRules, 'company-1');
    expect(wizardService.applyAll).toHaveBeenCalledWith('company-1');
    expect(state.executionStatus).toBe('done');
    expect(state.createdRules).toBe(2);
    expect(state.affectedTransactions).toBe(15);
  });

  it('executeApply should set executionError on failure', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.createRules as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API error'),
    );

    useWizardStore.setState({
      open: true, step: 3,
      proposedRules: [
        {
          id: 'r1', entityId: 'e1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: true,
        },
      ],
    });

    await useWizardStore.getState().executeApply('company-1');

    const state = useWizardStore.getState();
    expect(state.executionStatus).toBe('error');
    expect(state.executionError).toBe('API error');
  });

  it('executeApply should track partial rule creation failures', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.createRules as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: 'fulfilled', value: { data: { id: 'r1' } } },
      { status: 'rejected', reason: new Error('Failed to create rule for r2') },
    ]);
    (wizardService.applyAll as ReturnType<typeof vi.fn>).mockResolvedValue({
      matched: 10, total: 15,
    });

    useWizardStore.setState({
      open: true, step: 3,
      proposedRules: [
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
      ],
    });

    await useWizardStore.getState().executeApply('company-1');

    const state = useWizardStore.getState();
    expect(state.createdRules).toBe(1); // Only r1 succeeded
    expect(state.affectedTransactions).toBe(10);
    expect(state.executionStatus).toBe('done');
    // Partial failures should not set executionError, but createdRules reflects only successes
  });

  // ─── fetchEntities delta filter ──────────────────────────────────
  it('fetchEntities should filter out entities that already have existing rules', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    const mockEntities = [creditCandidate, debitCandidate];
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntities);
    // MERCADO LIBRE has an existing rule — should be filtered out
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([
      'mercado libre',
    ]);

    await useWizardStore.getState().fetchEntities('company-1');

    const state = useWizardStore.getState();
    expect(wizardService.fetchExistingEntityNames).toHaveBeenCalledWith('company-1');
    expect(state.entities).toHaveLength(1);
    expect(state.entities[0].candidate.canonicalName).toBe('AMERICAN EXPRESS');
  });

  it('fetchEntities should keep all entities when no existing rules', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    const mockEntities = [creditCandidate, debitCandidate];
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntities);
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await useWizardStore.getState().fetchEntities('company-1');

    const state = useWizardStore.getState();
    expect(state.entities).toHaveLength(2);
  });

  it('fetchEntities should return empty when all entities are filtered out', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    const mockEntities = [creditCandidate, debitCandidate];
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntities);
    // Both entities have existing rules
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockResolvedValue([
      'mercado libre',
      'american express',
    ]);

    await useWizardStore.getState().fetchEntities('company-1');

    const state = useWizardStore.getState();
    expect(state.entities).toHaveLength(0);
  });

  it('fetchEntities should handle API failure of existing rules gracefully', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    const mockEntities = [creditCandidate];
    (wizardService.fetchEntities as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntities);
    // If the existing rules API fails, entities should still load (no filtering)
    (wizardService.fetchExistingEntityNames as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Rules API error'),
    );

    await useWizardStore.getState().fetchEntities('company-1');

    const state = useWizardStore.getState();
    // Even though rules API failed, entities should still load
    expect(state.entities).toHaveLength(1);
    expect(state.entitiesLoading).toBe(false);
  });

  // ─── suggestRoleForOtro (Fix 1A) ───────────────────────────────────
  it('suggestRoleForOtro should set loading status before API call', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    let resolvePromise!: (val: unknown) => void;
    (wizardService.suggestRoleForEntity as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => { resolvePromise = resolve; }),
    );

    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    const fetchPromise = useWizardStore.getState().suggestRoleForOtro('entity-1', 'company-1');

    // Should be loading immediately
    const loadingState = useWizardStore.getState();
    expect(loadingState.entities[0].suggestionStatus).toBe('loading');

    resolvePromise({ suggestedRole: 'SOCIO', confidence: 0.85, explanation: 'test' });
    await fetchPromise;
  });

  it('suggestRoleForOtro should set suggestedRole and auto-assign on success', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.suggestRoleForEntity as ReturnType<typeof vi.fn>).mockResolvedValue({
      suggestedRole: 'SOCIO',
      confidence: 0.85,
      explanation: 'Matches merchant pattern',
    });

    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    await useWizardStore.getState().suggestRoleForOtro('entity-1', 'company-1');

    const state = useWizardStore.getState();
    expect(state.entities[0].suggestionStatus).toBe('success');
    expect(state.entities[0].suggestedRole).toBe('SOCIO');
    expect(state.entities[0].suggestionConfidence).toBe(0.85);
    expect(state.entities[0].assignedRole).toBe('SOCIO');
  });

  it('suggestRoleForOtro should skip if entity is not pending', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    const mockFn = wizardService.suggestRoleForEntity as ReturnType<typeof vi.fn>;

    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'success' as const },
      ],
    });

    await useWizardStore.getState().suggestRoleForOtro('entity-1', 'company-1');

    expect(mockFn).not.toHaveBeenCalled();
  });

  it('suggestRoleForOtro should set error status on failure', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.suggestRoleForEntity as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API error'),
    );

    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    await useWizardStore.getState().suggestRoleForOtro('entity-1', 'company-1');

    const state = useWizardStore.getState();
    expect(state.entities[0].suggestionStatus).toBe('error');
    expect(state.entities[0].assignedRole).toBeNull(); // Should not auto-assign on error
  });

  // ─── suggestAllRoles (Fix 1B) ──────────────────────────────────────
  it('suggestAllRoles should call suggestRoleForOtro for all pending entities', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.suggestRoleForEntity as ReturnType<typeof vi.fn>).mockResolvedValue({
      suggestedRole: 'PROVEEDOR',
      confidence: 0.75,
      explanation: 'test',
    });

    const debitCandidate2: EntityCandidate = {
      id: 'entity-3',
      canonicalName: 'OTRA EMPRESA',
      occurrences: 2,
      directionProfile: { creditPct: 0, debitPct: 1 },
      sampleDescriptions: ['OTRA EMPRESA pago'],
      totalAmount: 2000,
      direction: 'debit',
      amountCluster: 'variable',

      avgAmount: 1000,
      frequency: 'irregular',
    };

    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
        { candidate: debitCandidate, assignedRole: null, suggestionStatus: 'success' as const }, // Already resolved
        { candidate: debitCandidate2, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    await useWizardStore.getState().suggestAllRoles('company-1');

    expect(wizardService.suggestRoleForEntity).toHaveBeenCalledTimes(2); // Only pending entities
    expect(wizardService.suggestRoleForEntity).toHaveBeenCalledWith(creditCandidate, 'company-1');
    expect(wizardService.suggestRoleForEntity).toHaveBeenCalledWith(debitCandidate2, 'company-1');

    const state = useWizardStore.getState();
    expect(state.entities[0].suggestionStatus).toBe('success');
    expect(state.entities[1].suggestionStatus).toBe('success'); // Unchanged
    expect(state.entities[2].suggestionStatus).toBe('success');
  });

  it('suggestAllRoles should handle partial failures gracefully', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    (wizardService.suggestRoleForEntity as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ suggestedRole: 'SOCIO', confidence: 0.9, explanation: 'ok' })
      .mockRejectedValueOnce(new Error('API error'));

    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
        { candidate: debitCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    await useWizardStore.getState().suggestAllRoles('company-1');

    const state = useWizardStore.getState();
    expect(state.entities[0].suggestionStatus).toBe('success');
    expect(state.entities[0].assignedRole).toBe('SOCIO');
    expect(state.entities[1].suggestionStatus).toBe('error');
    expect(state.entities[1].assignedRole).toBeNull();
  });

  it('suggestAllRoles should do nothing when no entities are pending', async () => {
    const { wizardService } = await import('@/lib/services/wizard-service');
    useWizardStore.setState({
      open: true,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'success' as const },
      ],
    });

    await useWizardStore.getState().suggestAllRoles('company-1');

    expect(wizardService.suggestRoleForEntity).not.toHaveBeenCalled();
  });

  // ─── toggleRuleConfirmation (Fix 2A) ───────────────────────────────
  it('toggleRuleConfirmation should toggle isConfirmed from false to true', () => {
    useWizardStore.setState({
      proposedRules: [
        {
          id: 'r1', entityId: 'entity-1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: false,
        },
      ],
    });

    useWizardStore.getState().toggleRuleConfirmation('r1');
    expect(useWizardStore.getState().proposedRules[0].isConfirmed).toBe(true);
  });

  it('toggleRuleConfirmation should toggle isConfirmed from true to false', () => {
    useWizardStore.setState({
      proposedRules: [
        {
          id: 'r1', entityId: 'entity-1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: true,
        },
      ],
    });

    useWizardStore.getState().toggleRuleConfirmation('r1');
    expect(useWizardStore.getState().proposedRules[0].isConfirmed).toBe(false);
  });

  it('toggleRuleConfirmation should only affect the matching rule', () => {
    useWizardStore.setState({
      proposedRules: [
        {
          id: 'r1', entityId: 'e1', entityName: 'A', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'A',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: false,
        },
        {
          id: 'r2', entityId: 'e2', entityName: 'B', role: 'CLIENTE' as const,
          conditionType: 'contains' as const, conditionValue: 'B',
          transactionDirection: 'any' as const, debitGlAccountId: '4020', creditGlAccountId: '4020',
          isConfirmed: true,
        },
      ],
    });

    useWizardStore.getState().toggleRuleConfirmation('r1');
    const rules = useWizardStore.getState().proposedRules;
    expect(rules[0].isConfirmed).toBe(true);
    expect(rules[1].isConfirmed).toBe(true); // Unchanged
  });

  // ─── stepError (Fix 3A) ────────────────────────────────────────────
  it('nextStep should set stepError when guard fails on step 1 (no roles)', () => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entities: [
        { candidate: creditCandidate, assignedRole: null, suggestionStatus: 'pending' as const },
      ],
    });

    useWizardStore.getState().nextStep();
    const state = useWizardStore.getState();
    expect(state.step).toBe(1); // Did not advance
    expect(state.stepError).toBeTruthy(); // Error message set
    expect(typeof state.stepError).toBe('string');
  });

  it('nextStep should set stepError when guard fails on step 2 (no confirmed rules)', () => {
    useWizardStore.setState({
      open: true,
      step: 2,
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
      ],
      proposedRules: [
        {
          id: 'r1', entityId: 'entity-1', entityName: 'MERCADO LIBRE', role: 'SOCIO' as const,
          conditionType: 'contains' as const, conditionValue: 'MERCADO LIBRE',
          transactionDirection: 'any' as const, debitGlAccountId: '3040', creditGlAccountId: '3010',
          isConfirmed: false,
        },
      ],
    });

    useWizardStore.getState().nextStep();
    const state = useWizardStore.getState();
    expect(state.step).toBe(2); // Did not advance
    expect(state.stepError).toBeTruthy();
  });

  it('nextStep should clear stepError and advance when guard passes', () => {
    useWizardStore.setState({
      open: true,
      step: 1,
      entities: [
        { candidate: creditCandidate, assignedRole: 'SOCIO' as const, suggestionStatus: 'pending' as const },
      ],
      proposedRules: [],
      stepError: 'previous error', // Should be cleared
    });

    useWizardStore.getState().nextStep();
    const state = useWizardStore.getState();
    expect(state.step).toBe(2);
    expect(state.stepError).toBeNull(); // Cleared on success
  });

  it('reset should clear stepError', () => {
    useWizardStore.setState({
      step: 1,
      stepError: 'some error',
    });

    useWizardStore.getState().reset();
    expect(useWizardStore.getState().stepError).toBeNull();
  });
});
