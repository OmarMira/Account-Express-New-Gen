# Tasks: Fase 2 — Wizard de Reglas Bancarias (3 pasos)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800 (9 files: 8 new, 1 modified + tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Foundation (store + service) → PR 2: Wizard UI → PR 3: Integration |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Store + service foundation | PR 1 | wizard-store, wizard-service, barrel + unit tests |
| 2 | Wizard UI components | PR 2 | All 5 components + component tests |
| 3 | BankRulesPage integration | PR 3 | Button wiring + E2E test |

PR #1 base = feature/tracker branch `fase-2-wizard`. PR #2 base = PR #1 branch. PR #3 base = PR #2 branch.

## Phase 1: Foundation — Store + Service

- [x] 0.1 Create `src/app/api/learning/smart-classify/route.ts` — dedicated endpoint calling `clusterByBehavior()` for the wizard flow
- [x] 1.1 Create `src/lib/stores/wizard-store.ts` with WizardEntity, ProposedRule, WizardState types + actions
- [x] 1.2 Create `src/lib/services/wizard-service.ts` with fetchEntities, suggestRole, createRules, applyAll
- [x] 1.3 Create `src/components/wizard/index.ts` barrel export

## Phase 2: Core UI — Wizard Components

- [x] 2.1 Create `src/components/wizard/WizardEmptyState.tsx` ("Todo al día" placeholder)
- [x] 2.2 Create `src/components/wizard/WizardStep1.tsx` — entity table + role dropdown + AI suggestion banners
- [x] 2.3 Create `src/components/wizard/WizardStep2.tsx` — rule review table + AccountSelector per row
- [x] 2.4 Create `src/components/wizard/WizardStep3.tsx` — execution progress + summary with affected transactions
- [x] 2.5 Create `src/components/wizard/WizardDialog.tsx` — Dialog container routing step 1↔2↔3

## Phase 3: Integration — BankRulesPage

- [x] 3.1 Add "Configuración Inteligente" button + wizard open in `src/components/spa/BankRulesPage.tsx`

## Phase 4: Testing

- [x] 4.1 Unit tests: store transitions (open/close/step/reset), role assignment, rule derivation from ROLE_ACCOUNT_MAP
- [x] 4.2 Unit tests: delta filter (exclude entities with active rules)
- [x] 4.3 Component tests: each wizard step renders + responds to store state
- [x] 4.4 Integration test: full flow open → classify → review → execute (mocked API)

## Phase 5: Post-Verify Fixes

- [x] 5.1 Implement `suggestRoleForOtro` action in wizard-store — calls wizardService.suggestRoleForEntity(), transitions loading→success/error, auto-assigns role on success
- [x] 5.2 Implement `suggestAllRoles` action — calls suggestRoleForOtro for all pending entities via Promise.allSettled
- [x] 5.3 Integrate AI suggestions in WizardStep1 — auto-trigger suggestAllRoles on mount, show loading/success/error states, confidence badges per row
- [x] 5.4 Implement `toggleRuleConfirmation` action — replaces direct setState() in WizardStep2 with proper store action
- [x] 5.5 Add `stepError` state — nextStep sets user-friendly message on guard failure instead of silent return, clears on success
- [x] 5.6 Show stepError inline in WizardStep1 as alert banner
- [x] 5.7 Test coverage: all new store actions (14 new tests), AI suggestion UI (6 new component tests), stepError display (2 new component tests)
