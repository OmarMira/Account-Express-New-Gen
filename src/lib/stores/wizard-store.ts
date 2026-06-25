import { create } from 'zustand';
import type { EntityRole } from '@/lib/constants/entity-roles';
import { ROLE_ACCOUNT_MAP } from '@/lib/constants/role-account-map';
import type { EntityCandidate } from '@/lib/services/entity-detector';
import { wizardService } from '@/lib/services/wizard-service';

// ─── Shared Types ────────────────────────────────────────────────────
export type WizardStep = 1 | 2 | 3;

export type ExecutionStatus = 'idle' | 'loading' | 'done' | 'error';

export interface WizardEntity {
  candidate: EntityCandidate;
  assignedRole: EntityRole | null;
  suggestedRole?: string;
  suggestionConfidence?: number;
  suggestionStatus: 'pending' | 'loading' | 'success' | 'error';
}

export interface ProposedRule {
  id: string;
  entityId: string;
  entityName: string;
  role: EntityRole;
  conditionType: 'contains';
  conditionValue: string;
  transactionDirection: 'credit' | 'debit' | 'any';
  debitGlAccountId: string | null;
  creditGlAccountId: string | null;
  isConfirmed: boolean;
}

// ─── State Interface ─────────────────────────────────────────────────
interface WizardState {
  open: boolean;
  step: WizardStep;
  entities: WizardEntity[];
  entitiesLoading: boolean;
  entitiesError: string | null;
  proposedRules: ProposedRule[];
  executionStatus: ExecutionStatus;
  executionError: string | null;
  affectedTransactions: number;
  createdRules: number;
  stepError: string | null;

  // Actions
  openWizard: () => void;
  closeWizard: () => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
  fetchEntities: (companyId: string) => Promise<void>;
  setEntityRole: (entityId: string, role: EntityRole) => void;
  suggestRoleForOtro: (entityId: string, companyId: string) => Promise<void>;
  suggestAllRoles: (companyId: string) => Promise<void>;
  buildProposedRules: () => void;
  toggleRuleConfirmation: (ruleId: string) => void;
  updateRuleGlAccount: (ruleId: string, debit: string | null, credit: string | null) => void;
  executeApply: (companyId: string) => Promise<void>;
}

// ─── Default State ───────────────────────────────────────────────────
const defaultState = {
  open: false,
  step: 1 as WizardStep,
  entities: [] as WizardEntity[],
  entitiesLoading: false,
  entitiesError: null as string | null,
  proposedRules: [] as ProposedRule[],
  executionStatus: 'idle' as ExecutionStatus,
  executionError: null as string | null,
  affectedTransactions: 0,
  createdRules: 0,
  stepError: null as string | null,
};

// ─── Store ───────────────────────────────────────────────────────────
export const useWizardStore = create<WizardState>()((set, get) => ({
  ...defaultState,

  openWizard: () => set({ open: true, step: 1 }),

  closeWizard: () => {
    get().reset();
  },

  reset: () => set({ ...defaultState }),

  nextStep: () => {
    const state = get();
    const nextStep = (state.step + 1) as WizardStep;

    // Guard: step 1 → 2 requires at least one entity with an assigned role
    if (state.step === 1 && nextStep === 2) {
      const hasRole = state.entities.some((e) => e.assignedRole !== null);
      if (!hasRole) {
        set({ stepError: 'Asigná al menos un rol a una entidad antes de continuar.' });
        return;
      }
      // Auto-build proposed rules from assigned roles before advancing
      get().buildProposedRules();
    }

    // Guard: step 2 → 3 requires at least one confirmed rule
    if (state.step === 2 && nextStep === 3) {
      const hasConfirmedRule = state.proposedRules.some((r) => r.isConfirmed);
      if (!hasConfirmedRule) {
        set({ stepError: 'Confirmá al menos una regla antes de continuar.' });
        return;
      }
    }

    set({ step: nextStep, stepError: null });
  },

  prevStep: () => {
    const state = get();
    if (state.step > 1) {
      set({ step: (state.step - 1) as WizardStep });
    }
  },

  fetchEntities: async (companyId: string) => {
    set({ entitiesLoading: true, entitiesError: null });
    try {
      // Fetch existing rule names for delta filter (graceful — failure doesn't block entity loading)
      let existingNames: string[] = [];
      try {
        existingNames = await wizardService.fetchExistingEntityNames(companyId);
      } catch {
        // Delta filter unavailable — proceed without filtering
      }

      const candidates = await wizardService.fetchEntities(companyId);

      // Delta filter: exclude entities that already have a matching rule
      const existingSet = new Set(existingNames.map((n) => n.toLowerCase().trim()));
      const filteredCandidates = candidates.filter(
        (c: EntityCandidate) => !existingSet.has(c.canonicalName.toLowerCase().trim()),
      );

      const wizardEntities: WizardEntity[] = filteredCandidates.map((c: EntityCandidate) => ({
        candidate: c,
        assignedRole: null,
        suggestionStatus: 'pending' as const,
      }));
      set({ entities: wizardEntities, entitiesLoading: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch entities';
      set({ entitiesError: msg, entitiesLoading: false, entities: [] });
    }
  },

  setEntityRole: (entityId: string, role: EntityRole) => {
    const state = get();
    const updatedEntities = state.entities.map((e) =>
      e.candidate.id === entityId ? { ...e, assignedRole: role } : e,
    );
    set({ entities: updatedEntities });
  },

  suggestRoleForOtro: async (entityId: string, companyId: string) => {
    const entity = get().entities.find((e) => e.candidate.id === entityId);
    if (!entity || entity.suggestionStatus !== 'pending') return;

    // Mark as loading
    set({
      entities: get().entities.map((e) =>
        e.candidate.id === entityId ? { ...e, suggestionStatus: 'loading' as const } : e,
      ),
    });

    try {
      const result = await wizardService.suggestRoleForEntity(entity.candidate, companyId);
      set({
        entities: get().entities.map((e) =>
          e.candidate.id === entityId
            ? {
                ...e,
                suggestedRole: result.suggestedRole,
                suggestionConfidence: result.confidence,
                suggestionStatus: 'success' as const,
                assignedRole: result.suggestedRole as EntityRole,
              }
            : e,
        ),
      });
    } catch {
      set({
        entities: get().entities.map((e) =>
          e.candidate.id === entityId ? { ...e, suggestionStatus: 'error' as const } : e,
        ),
      });
    }
  },

  suggestAllRoles: async (companyId: string) => {
    const pendingEntities = get().entities.filter((e) => e.suggestionStatus === 'pending');
    if (pendingEntities.length === 0) return;

    await Promise.allSettled(
      pendingEntities.map((e) => get().suggestRoleForOtro(e.candidate.id, companyId)),
    );
  },

  toggleRuleConfirmation: (ruleId: string) => {
    set({
      proposedRules: get().proposedRules.map((r) =>
        r.id === ruleId ? { ...r, isConfirmed: !r.isConfirmed } : r,
      ),
    });
  },

  buildProposedRules: () => {
    const state = get();
    const rolesWithMapping = state.entities.filter(
      (e): e is WizardEntity & { assignedRole: EntityRole } => e.assignedRole !== null,
    );

    const rules: ProposedRule[] = rolesWithMapping
      .filter((e) => {
        const mapping = ROLE_ACCOUNT_MAP[e.assignedRole];
        return mapping !== undefined;
      })
      .map((e) => {
        const mapping = ROLE_ACCOUNT_MAP[e.assignedRole]!;
        let transactionDirection: 'credit' | 'debit' | 'any' = 'any';
        if (mapping.expectedDirection === 'credit') transactionDirection = 'credit';
        else if (mapping.expectedDirection === 'debit') transactionDirection = 'debit';

        return {
          id: `rule-${e.candidate.id}`,
          entityId: e.candidate.id,
          entityName: e.candidate.canonicalName,
          role: e.assignedRole,
          conditionType: 'contains' as const,
          conditionValue: e.candidate.canonicalName,
          transactionDirection,
          debitGlAccountId: mapping.debit,
          creditGlAccountId: mapping.credit,
          isConfirmed: false,
        };
      });

    set({ proposedRules: rules });
  },

  updateRuleGlAccount: (ruleId: string, debit: string | null, credit: string | null) => {
    const state = get();
    const updatedRules = state.proposedRules.map((r) =>
      r.id === ruleId ? { ...r, debitGlAccountId: debit, creditGlAccountId: credit } : r,
    );
    set({ proposedRules: updatedRules });
  },

  executeApply: async (companyId: string) => {
    const state = get();
    set({ executionStatus: 'loading', executionError: null });
    try {
      const results = await wizardService.createRules(state.proposedRules, companyId);

      // Count fulfilled results (partial successes)
      const createdCount = results.filter((r) => r.status === 'fulfilled').length;

      const applyResult = await wizardService.applyAll(companyId);

      set({
        executionStatus: 'done',
        createdRules: createdCount,
        affectedTransactions: applyResult.matched ?? 0,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      set({ executionStatus: 'error', executionError: msg });
    }
  },
}));
