# Tasks: Intent-First Entity Onboarding

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 520-750 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 API/service persistence → PR 2 modal UX → PR 3 BankRule audit exposure |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Suggested commit |
|------|------|-----------|------------------|
| 1 | Persist intent-first context safely without invalid rules | PR 1 | `feat(learning): save intent-first entity context safely` |
| 2 | Replace role-first modal path with intent-first UX | PR 2 | `feat(learning): make entity onboarding intent first` |
| 3 | Expose OTHER audit context through BankRule APIs | PR 3 | `feat(bank-rules): expose linked entity context audit data` |

## Phase 1: API and Service Foundation (depends on specs/design)

- [x] 1.1 RED: Add classify-entity API tests in `tests/api/learning/classify-entity.test.ts` for invalid intent, OTHER description persistence, low-confidence non-blocking save, and no rule without GL account.
- [x] 1.2 GREEN: Update `src/app/api/learning/classify-entity/route.ts` to accept intent-first payload, validate `OTHER` text by intent, derive internal role, and return `{ ruleCreated:false, requiresReview:true }` warning when no GL account exists.
- [x] 1.3 RED: Add service tests for role derivation, normalized `transactionDirection`, duplicate/reactivate behavior, source guard, and intent on created rules.
- [x] 1.4 GREEN: Update `src/lib/services/entity-classifier.ts` and `src/lib/services/entity-context-service.ts` so `EntityContext` saves before safe `BankRule` creation, stores trimmed `userDescription`, and never creates placeholder-account rules.

## Phase 2: Intent-First Modal UX (depends on Phase 1 contract)

- [x] 2.1 RED: Extend `tests/components/EntityOnboardingModal.test.tsx` for hidden/non-editable role path, bilingual intent Select, OTHER textarea validation, save payload, and pure-credit Income label.
- [x] 2.2 GREEN: Update `src/components/learning/EntityOnboardingModal.tsx` to drive save readiness from `TransactionIntent`, hide role from the primary flow, show `OTHER` free text, send `intent/userDescription/glAccountCode`, and use shared normalized direction helper from `src/lib/services/direction-filter.ts`.
- [x] 2.3 REFACTOR: Remove modal-local percentage threshold logic and role-first validation branches; keep any actor role display read-only/contextual if retained.

## Phase 3: BankRule Audit Exposure (depends on Phase 1 context link)

- [x] 3.1 RED: Add/extend BankRule API tests under `tests/api/bank-rules/` proving list/detail responses include `entityContext.userDescription` and no BankRule description column is required.
- [x] 3.2 GREEN: Update `src/app/api/bank-rules/route.ts` and `src/app/api/bank-rules/[id]/route.ts` to include `entityContext: { id, userDescription, role, pattern }` where rules are fetched for review/audit.

## Phase 4: Verification

- [x] 4.1 Run targeted Vitest files from Phases 1-3, then `bun x vitest --reporter=verbose --no-file-parallelism`.
- [x] 4.2 Run `npx tsc --noEmit` and verify no Prisma schema/migration or BankRule column changes were introduced.
