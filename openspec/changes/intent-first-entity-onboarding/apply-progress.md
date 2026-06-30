# Apply Progress: Intent-First Entity Onboarding

## Current Slice

- Slice: BankRule audit/admin exposure / PR 3
- Delivery: chained PRs selected
- Chain strategy: feature-branch-chain
- Review budget: 400 changed lines
- Mode: Strict TDD

## Regression Fix Slice

- Scope: Post UI/Frontend regression fixes only.
- Fixed legacy OTRO compatibility in `classifyEntity`: `userDescription` is now required when either `intent === 'OTHER'` or the final persisted role is `OTRO`, including derived-role paths.
- Removed obsolete `tests/components/batch-otro-classification.test.tsx`; its role-combobox/pre-classify/suggestion-banner assertions target the old role-first flow, while current intent-first modal behavior is covered by `tests/components/EntityOnboardingModal.test.tsx`.

## Critical Architecture Blocker Fix Slice

- Scope: Intent-to-role ownership correction before commits.
- Removed client-side intent-to-role derivation from `EntityOnboardingModal`; intent-first classification payloads now send `intent` plus applicable user description, direction, pattern, and input fields without `role`.
- Preserved legacy role payload support only when no intent is present in legacy auto-save/pre-classify paths.
- Updated backend role derivation so a provided role no longer overrides backend truth when intent is present; valid provided roles are preserved only for non-intent legacy flows.
- Added API/service regression coverage for conflicting provided role + intent and component assertions that intent-first payloads omit `role` while preserving `userDescription` behavior.

## BankRule Audit Exposure Slice

- Scope: BankRule API/admin exposure only.
- Exposed linked `entityContext` audit data (`id`, `userDescription`, `role`, `pattern`) in BankRule list and detail/update fetches without adding BankRule columns or migrations.
- Added BankRule API coverage proving OTHER explanations are auditable through `BankRule.entityContext.userDescription` and not duplicated as a top-level BankRule description field.

## Completed Tasks

- [x] 1.1 RED: Added classify-entity API coverage for invalid intent, OTHER description validation/persistence, low-confidence non-blocking save, and unresolved GL account review metadata.
- [x] 1.2 GREEN: Updated classify-entity API to accept intent-first payloads, validate OTHER by intent, derive internal role, persist trimmed `userDescription`, and return `ruleCreated:false` / `requiresReview:true` when no valid GL account is available.
- [x] 1.3 RED: Added service coverage for normalized direction threshold boundaries, 12 positive / 0 negative credit direction, role derivation, trimmed OTHER persistence, and OTRO-role compatibility outside OTHER intent.
- [x] 1.4 GREEN: Updated entity classifier/context persistence to derive/preserve roles, use normalized `>= 0.8` direction thresholds from DB transaction counts, trim `EntityContext.userDescription`, preserve source guard behavior, and avoid placeholder-account rule creation.
- [x] 2.1 RED: Replaced role-first component coverage with intent-first modal tests for hidden role combobox, required intent save readiness, OTHER explanation validation/payload, and normalized direction labels.
- [x] 2.2 GREEN: Updated `EntityOnboardingModal` to make intent the primary control, hide role selection from the main flow, show/validate OTHER free text, and submit `intent` plus trimmed `userDescription`. Note: the initial client-side role fallback from this UI slice was later removed by the Critical Architecture Blocker Fix Slice so intent-first payloads omit `role`.
- [x] 2.3 REFACTOR: Removed modal-local `> 70` direction labeling and role-first save button branches in favor of shared `classifyDirection()` and intent-driven readiness.
- [x] 3.1 RED: Added BankRule API tests proving list/detail responses include `entityContext.userDescription` and do not require a BankRule description field.
- [x] 3.2 GREEN: Updated BankRule list/detail/update includes to project linked `EntityContext` audit fields for review/admin inspection.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/api/learning/classify-entity.test.ts` | API/unit with mocks | ✅ 47/47 baseline for API + classifier | ✅ Written; failed with 500/missing metadata | ✅ Passed in targeted run | ✅ Invalid intent, OTHER missing/valid, low confidence, no GL | ✅ Kept assertions behavior-focused |
| 1.2 | `tests/api/learning/classify-entity.test.ts` | API/unit with mocks | ✅ Covered by 1.1 baseline | ✅ Tests from 1.1 drove API changes | ✅ Passed in targeted run | ✅ Role derivation and no-rule paths covered | ✅ Reused service helper for role derivation |
| 1.3 | `tests/services/entity-classifier.test.ts`; `tests/services/entity-context-service.test.ts` | Unit/service | ✅ 47/47 classifier/API and 19/19 entity-context baseline | ✅ Written; failed on missing helper, `> 0.8`, untrimmed text, missing audit field | ✅ Passed in targeted run | ✅ Boundary 0.8, pure credit, OTHER, non-OTHER OTRO | ✅ Pure helper `deriveRoleFromIntent` extracted |
| 1.4 | `tests/services/entity-classifier.test.ts`; `tests/services/entity-context-service.test.ts` | Unit/service | ✅ Covered by 1.3 baseline | ✅ Tests from 1.3 drove service changes | ✅ Passed in targeted run | ✅ No GL warning, source guard, trimmed persistence | ✅ Minimal conditional persistence to preserve existing call shape |
| 2.1 | `tests/components/EntityOnboardingModal.test.tsx` | Component/integration | ✅ 30/30 existing component tests passed before edits | ✅ New intent-first tests failed against role-first UI | ✅ Passed after modal update | ✅ Intent required, OTHER text/payload, credit/debit/mixed labels | ✅ Focused tests on user-visible behavior |
| 2.2 | `tests/components/EntityOnboardingModal.test.tsx` | Component/integration | ✅ Covered by 2.1 baseline | ✅ Tests from 2.1 drove UI changes | ✅ 4/4 targeted component tests passed | ✅ Hidden role + OTHER persistence covered; initial role fallback was superseded by the final backend-owned derivation correction | ✅ Kept backend warnings/review behavior untouched |
| 2.3 | `tests/components/EntityOnboardingModal.test.tsx` | Component/integration | ✅ Covered by 2.1 baseline | ✅ Direction label test failed on mixed label for pure credit | ✅ 4/4 targeted component tests passed | ✅ Credit, debit, mixed, normalized threshold helper | ✅ Reused shared `classifyDirection()` |
| Regression | `tests/services/otro-persistence.test.ts`; `tests/services/entity-classifier.test.ts`; `tests/components/EntityOnboardingModal.test.tsx` | Service/component | ⚠️ Initial targeted run had 5 expected regressions: legacy OTRO accepted without description and obsolete role-first batch UI assertions failed | ✅ Existing `otro-persistence` legacy OTRO test failed; classifier regression test updated to require OTRO description | ✅ Remaining targeted suites passed after service fix and obsolete suite deletion | ✅ Covered provided OTRO role and derived OTHER→OTRO role paths | ✅ Validation uses `finalRole` before persistence |
| 3.1 | `tests/api/bank-rules/validation.test.ts`; `tests/api/bank-rules/id-route.test.ts` | API/unit with mocks | ✅ 18/18 existing BankRule route tests passed before edits | ✅ Written first; failed because BankRule fetch includes omitted `entityContext` | ✅ 21/21 targeted BankRule route tests passed | ✅ List, paginated list, and detail inspection covered | ✅ Kept assertions on response contract and Prisma projection |
| 3.2 | `tests/api/bank-rules/validation.test.ts`; `tests/api/bank-rules/id-route.test.ts` | API/unit with mocks | ✅ Covered by 3.1 safety net | ✅ Tests from 3.1 drove route include changes | ✅ 21/21 targeted BankRule route tests passed | ✅ Both listed and inspected BankRule paths covered | ✅ Shared local select constants avoid repeated projection literals per route file |

## Verification

- ✅ `bun x vitest tests/api/learning/classify-entity.test.ts tests/services/entity-classifier.test.ts tests/services/entity-context-service.test.ts --reporter=verbose --no-file-parallelism` — 3 files passed, 78 tests passed.
- ✅ `npx -p typescript tsc --noEmit` — passed with no output.
- ✅ `bun x vitest tests/components/EntityOnboardingModal.test.tsx --reporter=verbose --no-file-parallelism` — 1 file passed, 4 tests passed.
- ✅ `npx -p typescript tsc --noEmit` — passed with no output after UI slice.
- ✅ `npx vitest run tests/services/otro-persistence.test.ts tests/services/entity-classifier.test.ts tests/components/EntityOnboardingModal.test.tsx` — 3 files passed, 57 tests passed after deleting obsolete `batch-otro-classification.test.tsx`.
- ✅ `npx -p typescript tsc --noEmit` — passed with no output after regression fixes.
- ⚠️ Test setup warning: Prisma generate failed in test setup; suite continued under the existing setup fallback and passed.
- ✅ `bun x vitest tests/api/bank-rules/validation.test.ts tests/api/bank-rules/id-route.test.ts --reporter=verbose --no-file-parallelism` — safety net passed before edits, 2 files passed, 18 tests passed.
- ✅ `bun x vitest tests/api/bank-rules/validation.test.ts tests/api/bank-rules/id-route.test.ts --reporter=verbose --no-file-parallelism` — after BankRule audit exposure, 2 files passed, 21 tests passed.
- ✅ `npx -p typescript tsc --noEmit` — passed with no output after BankRule audit exposure.
- ✅ `npx vitest run tests/components/EntityOnboardingModal.test.tsx tests/api/learning/classify-entity.test.ts tests/services/entity-classifier.test.ts` — 3 files passed, 64 tests passed after critical role/intent ownership fix.
- ✅ `npx -p typescript tsc --noEmit` — passed with no output after critical role/intent ownership fix.
- ✅ Grep check: `EntityOnboardingModal` has no `deriveRoleFromIntent`, no `role: finalRole`, and only conditionally spreads `role: sel.role` when `!intent` for legacy pre-classify paths.
- ✅ Final targeted verification evidence is recorded in `verify-report.md`: 7 change-specific files passed, 111 tests passed, and typecheck passed. Intent-first UI payloads omit `role`; backend derives role when `intent` exists.

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/app/api/learning/classify-entity/route.ts` | Modified | Intent-first validation, role derivation, review metadata for unresolved GL account, audit details. |
| `src/lib/services/entity-classifier.ts` | Modified | `deriveRoleFromIntent`, normalized `>= 0.8` DB-count direction threshold, OTHER validation by intent, trimmed description persistence. |
| `src/lib/services/entity-context-service.ts` | Modified | Trims `userDescription` and includes it in audit details. |
| `tests/api/learning/classify-entity.test.ts` | Modified | API regression tests for backend slice. |
| `tests/services/entity-classifier.test.ts` | Modified | Direction, role derivation, OTHER/no-GL service tests. |
| `tests/services/entity-context-service.test.ts` | Modified | Trimmed description and audit details tests. |
| `openspec/changes/intent-first-entity-onboarding/tasks.md` | Modified | Marked Backend slice tasks 1.1-1.4 complete. |
| `src/components/learning/EntityOnboardingModal.tsx` | Modified | Intent-first primary flow, hidden role selection, OTHER description UX, shared normalized direction label helper; final correction omits `role` from intent-first payloads. |
| `src/i18n/locales/en.ts` | Modified | Updated intent placeholder and OTHER description copy. |
| `src/i18n/locales/es.ts` | Modified | Updated intent placeholder and OTHER description copy. |
| `tests/components/EntityOnboardingModal.test.tsx` | Modified | Focused component coverage for intent-first UI, hidden role, OTHER payload, and direction labels. |
| `openspec/changes/intent-first-entity-onboarding/tasks.md` | Modified | Marked UI slice tasks 2.1-2.3 complete. |
| `tests/services/entity-classifier.test.ts` | Modified | Added/updated regression coverage for legacy `OTRO` description validation and derived OTHER role persistence. |
| `tests/components/batch-otro-classification.test.tsx` | Deleted | Removed obsolete role-first batch UI suite superseded by intent-first modal tests. |
| `openspec/changes/intent-first-entity-onboarding/apply-progress.md` | Modified | Recorded regression fix slice and verification. |
| `src/app/api/bank-rules/route.ts` | Modified | BankRule list and paginated list responses now include linked entity context audit fields. |
| `src/app/api/bank-rules/[id]/route.ts` | Modified | BankRule detail and update responses now include linked entity context audit fields. |
| `tests/api/bank-rules/validation.test.ts` | Modified | Added list/paginated list coverage for linked `entityContext.userDescription`. |
| `tests/api/bank-rules/id-route.test.ts` | Modified | Added detail coverage for linked `entityContext.userDescription`. |
| `openspec/changes/intent-first-entity-onboarding/tasks.md` | Modified | Marked BankRule audit exposure tasks 3.1-3.2 complete. |
| `src/components/learning/EntityOnboardingModal.tsx` | Modified | Removed client-side intent-to-role derivation and omitted `role` from intent-first classify payloads. |
| `src/lib/services/entity-classifier.ts` | Modified | Backend intent role derivation now ignores provided role when intent is present; legacy non-intent role support remains. |
| `tests/components/EntityOnboardingModal.test.tsx` | Modified | Asserted intent-first payloads include `intent` and omit `role`, including OTHER with `userDescription`. |
| `tests/api/learning/classify-entity.test.ts` | Modified | Added regression coverage for conflicting provided role being ignored when intent is present. |
| `tests/services/entity-classifier.test.ts` | Modified | Added derivation coverage for backend-only intent truth and legacy non-intent role preservation. |

## Deviations / Notes

- Existing `EntityContext` schema has `userDescription` but no `intent` column; this slice persists OTHER free text on `EntityContext` and preserves intent on created/reactivated `BankRule` as existing schema allows.
- The UI no longer sends an internal role fallback for intent-first API calls; backend derives role from intent as the single source of truth. Legacy role submission remains only for non-intent paths.
- BankRule audit exposure deliberately uses the existing `BankRule.entityContext` relation; no BankRule description column or migration was added.

## Remaining Tasks

- [ ] Full Phase 4 verification after all slices.
- [ ] Commit preparation remains pending; no commit, push, or stash operation was performed in this blocker fix slice.
