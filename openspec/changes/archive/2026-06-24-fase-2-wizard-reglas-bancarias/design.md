# Design: Fase 2 — Wizard de Reglas Bancarias (3 pasos)

## Technical Approach

Additive 3-step wizard inside a `Dialog`. A Zustand store drives the linear state machine: classify → review → execute. No new API endpoints — reuses `GET /api/learning/classify-entity`, `POST /api/learning/suggest-role`, `POST /api/bank-rules`, `POST /api/bank-rules/apply-all`.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Local React state | Too much shared state across 3 steps | Rejected |
| Zustand store | Matches existing pattern, clean step transitions, easy reset on close | ✅ Chosen |

## Zustand Store (critical — PO request)

```typescript
export type WizardStep = 1 | 2 | 3;
export type ExecutionStatus = 'idle' | 'loading' | 'done' | 'error';

export interface WizardEntity {
  candidate: EntityCandidate;        // from clusterByBehavior
  assignedRole: EntityRole | null;   // user-confirmed role
  suggestedRole?: string;            // AI suggestion for OTRO
  suggestionConfidence?: number;
  suggestionStatus: 'pending' | 'loading' | 'success' | 'error';
}

export interface ProposedRule {
  id: string; entityId: string; entityName: string; role: EntityRole;
  conditionType: 'contains'; conditionValue: string;
  transactionDirection: 'credit' | 'debit' | 'any';
  debitGlAccountId: string | null; creditGlAccountId: string | null;
  isConfirmed: boolean;
}

interface WizardState {
  open: boolean; step: WizardStep;
  entities: WizardEntity[]; entitiesLoading: boolean; entitiesError: string | null;
  proposedRules: ProposedRule[];
  executionStatus: ExecutionStatus; executionError: string | null;
  affectedTransactions: number; createdRules: number;
  // Actions
  openWizard: () => void; closeWizard: () => void; nextStep: () => void; prevStep: () => void; reset: () => void;
  fetchEntities: (companyId: string) => Promise<void>;
  setEntityRole: (entityId: string, role: EntityRole) => void;
  suggestRoleForOtro: (entityId: string, companyId: string) => Promise<void>;
  buildProposedRules: () => void;
  updateRuleGlAccount: (ruleId: string, debit: string | null, credit: string | null) => void;
  executeApply: (companyId: string) => Promise<void>;
}
```

### Step transitions

| Action | From | To | Guard |
|--------|------|----|-------|
| `openWizard` | closed | 1 | fetch entities |
| `nextStep` | 1 | 2 | ≥1 entity has role |
| `nextStep` | 2 | 3 | ≥1 rule confirmed |
| `nextStep` | 3 | execute | executionStatus === 'done' → close |
| `prevStep` | 2 | 1 | always |
| `prevStep` | 3 | 2 | always (no rollback during execution) |
| `closeWizard` | any | closed | `reset()` clears store |

## Data Flow

```
BankRulesPage "Configuración Inteligente" → WizardDialog
  Paso 1: GET /api/learning/classify-entity → EntityCandidate[]
           client-side delta filter (exclude entities WITH active rules)
           user assigns role per entity
  Paso 2: buildProposedRules() → map role → ROLE_ACCOUNT_MAP[role].{debit,credit}
           user adjusts GL accounts
  Paso 3: POST /api/bank-rules (× N, sequential)
           POST /api/bank-rules/apply-all
           → summary (transactions affected)
```

## Component Tree

```
src/components/wizard/
├── WizardDialog.tsx        ← Dialog container, reads store.step
├── WizardStep1.tsx         ← Entity table with role dropdowns + AI suggestion banners
├── WizardStep2.tsx         ← Rules review with AccountSelector per row
├── WizardStep3.tsx         ← Execution progress + final summary
├── WizardEmptyState.tsx    ← "All classified" placeholder
└── index.ts
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/stores/wizard-store.ts` | Create | Zustand store |
| `src/components/wizard/` (4 files + index) | Create | Wizard components |
| `src/components/spa/BankRulesPage.tsx` | Modify | Add "Configuración Inteligente" button + wizard open |

Modification in BankRulesPage: insert a `<Sparkles>` button alongside existing ones that calls `store.openWizard()`. Use shadcn Dialog for the wizard container.

## Edge Cases

| Case | Behavior |
|------|----------|
| All entities already classified | `fetchEntities` returns 0 → WizardEmptyState |
| Close mid-flow | `reset()` clears store, nothing committed |
| API failure on fetch/suggest/build | Per-step error state with retry |
| API failure on rule creation (Paso 3) | `executionStatus = 'error'`, show partial results |
| All entities = IGNORADA | `buildProposedRules` returns [] → block advance to step 3 |
| Large entity list | Scrollable table inside Dialog (max-h-[70vh]) |

## Interfaces / Contracts

No new APIs. Reuses existing endpoints:
- `GET /api/learning/classify-entity?companyId=X` → `{ data: EntityCandidate[] }`
- `POST /api/learning/suggest-role` → `{ suggestedRole, confidence, explanation }`
- `POST /api/bank-rules` → `{ data: BankRule }`
- `POST /api/bank-rules/apply-all` → `{ matched, total }`
- GL account resolution via `ROLE_ACCOUNT_MAP` (client-side constant in `role-account-map.ts`)

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Store transitions, role assignment, rule derivation | Pure function tests on store |
| Unit | Delta filter logic | Pure function tests |
| Integration | Full flow with mocked API | Component test |
| E2E | Open → classify → review → execute | Playwright |

## Migration

No migration required. Wizard is additive; old flows remain as fallback.

## Open Questions

- [ ] Should clusterByBehavior() fetch via a dedicated endpoint or reuse classify-entity?
- [ ] Double confirmation before execute in Paso 3?
- [ ] Handle split entities (credit/debit/both from EntityOnboardingModal)?
