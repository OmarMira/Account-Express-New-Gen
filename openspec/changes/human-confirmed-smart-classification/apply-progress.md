# Apply Progress: Human-Confirmed Smart Classification — PR1 Foundation + PR2 Aggregation

## Scope

Implemented PR1 foundation and PR2 aggregation/classification service layer only. PR3 confirmation endpoint, rule creation after confirmation, learning UI/API workflow, and UI pending-review surfacing remain untouched.

## Review Workload / Size Exception

- **Decision**: `size:exception` maintainer-approved for PR2 Aggregation + Classification.
- **Budget impact**: PR2 is approximately 718 source/test lines, above the 400-line review budget.
- **Rationale**: Aggregation and classification are cohesive in this slice: the smart classifier depends directly on the history aggregator, and splitting them would create artificial dependency overhead without improving review clarity.
- **Verification supporting exception**: 126 focused tests passed, `bun x tsc --noEmit` passed, and fresh verification found no CRITICAL issues.
- **Proceeding status**: PR2 may proceed to commit/push with this size exception documented.

## Completed Tasks

- [x] 1.1 Add/verify Prisma fields for nullable role, `classificationStatus`, confidence/suggestion metadata, and migration rollback counts.
- [x] 1.2 Write migration converting legacy `EntityContext.role = 'OTRO'` to `role = null` + `PENDING_REVIEW`, preserving `pattern`, `userDescription`, `glAccountId`, timestamps, and linked `BankRule` references.
- [x] 1.3 Ensure migrated OTRO contexts never create, activate, delete, deactivate, or overwrite BankRules automatically; surface linked rule/account for review.
- [x] 1.4 Add model/schema tests proving nullable role, classification state, confidence storage, and legacy OTRO migration safety.
- [x] 2.1 Create `src/lib/services/entity-history-analyzer.ts` with transaction count, total, active months, direction percentages, recurrence, amount stats, descriptions, prior context/rules.
- [x] 2.2 Add tests for multi-transaction aggregation, single-transaction cold-start summaries, mixed direction, recurrence labels, and preserved legacy `userDescription` context.
- [x] 2.3 Create `src/lib/services/smart-entity-classifier.ts` with generic runtime prompt builder, heuristic role/intent suggestions, confidence scoring, and one review question on insufficient evidence.
- [x] 2.4 Test prompt construction contains runtime tenant/entity summary only; no hardcoded sample names, amounts, or documentation examples.
- [x] 2.5 Implement cold-start and re-evaluation lifecycle: history can suggest pending updates, but confirmed classifications remain authoritative.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/services/entity-classification-foundation.test.ts` | Service/model | ✅ 49/49 existing entity context tests passed before changes | ✅ New tests failed on null role/status/confidence | ✅ New focused tests passed after schema/service update | ✅ Pending-review null role and confirmed confidence cases | ✅ Constants/types kept minimal |
| 1.2 | `tests/services/entity-classification-foundation.test.ts` | Unit/migration artifact | N/A (new migration) | ✅ Migration file assertions failed while file was absent | ✅ Migration content assertions passed | ✅ OTRO conversion plus field-preservation assertions | ➖ None needed |
| 1.3 | `tests/services/entity-classification-foundation.test.ts` | Unit/migration artifact + service/model | ✅ Existing behavior covered by focused regression suite | ✅ BankRule no-mutation assertion failed while migration was absent | ✅ Assertion passed; service preserves linked `glAccountId` in pending review state | ✅ Linked account preservation and BankRule non-mutation cases | ➖ None needed |
| 1.4 | `tests/services/entity-classification-foundation.test.ts` | Service/model | ✅ 49/49 baseline tests passed | ✅ New coverage failed before implementation | ✅ 5/5 new tests and 59/59 focused regression tests passed | ✅ Nullable role, pending status, confirmed status, confidence, linked account, migration safety | ✅ No broad PR2/PR3 behavior added |
| 2.1 | `tests/services/smart-classification-pr2.test.ts` | Unit/service | N/A (new service) | ✅ Test file failed on missing `entity-history-analyzer` module | ✅ PR2 focused tests passed after analyzer implementation | ✅ Monthly, single-transaction, mixed, and biweekly cases | ✅ Pure aggregation helpers extracted |
| 2.2 | `tests/services/smart-classification-pr2.test.ts` | Unit/service | N/A (new test coverage) | ✅ Aggregation expectations written before production module existed | ✅ 9/9 PR2 tests passed | ✅ Multi-transaction, cold-start, mixed direction, recurrence, preserved user description/rules | ✅ Deterministic fixtures kept local |
| 2.3 | `tests/services/smart-classification-pr2.test.ts` | Unit/service | N/A (new service) | ✅ Test file failed on missing `smart-entity-classifier` module | ✅ Prompt, heuristic, scoring, and review-question tests passed | ✅ Recurring credit tenant, debit vendor, mixed cap, cold-start cases | ✅ Prompt/scoring/classification functions separated |
| 2.4 | `tests/services/smart-classification-pr2.test.ts` | Unit/prompt | N/A (new prompt builder) | ✅ Prompt assertions existed before builder implementation | ✅ Runtime-only prompt assertions passed | ✅ Tenant/entity/summary included; documentation sample names/amounts excluded | ✅ Prompt builder is deterministic and side-effect free |
| 2.5 | `tests/services/smart-classification-pr2.test.ts` | Unit/lifecycle | N/A (new lifecycle logic) | ✅ Cold-start and confirmed-protection expectations written first | ✅ Lifecycle tests passed | ✅ Provisional cold-start and confirmed-context update suggestion cases | ✅ Confirmed contexts are protected from automatic overwrite by contract |

## Verification

- `bunx vitest run tests/services/entity-context-service.test.ts tests/services/entity-context-crud-service.test.ts` — PASS before changes, 49 tests.
- `bunx vitest run tests/services/entity-classification-foundation.test.ts` — RED before implementation, then PASS after implementation, 5 tests.
- `bunx vitest run tests/services/entity-classification-foundation.test.ts tests/services/entity-context-service.test.ts tests/services/entity-context-crud-service.test.ts tests/services/otro-persistence.test.ts` — PASS, 59 tests.
- `tsc --noEmit` — FAILED in PowerShell because `tsc` is not on PATH after Bun install.
- `npx tsc --noEmit` — FAILED because npm/npx did not detect the Bun-installed local TypeScript package.
- `bun x tsc --noEmit` — PASS.

### Critical Remediation Verification

- `bunx vitest run tests/services/entity-context-service.test.ts tests/services/signal-collector.test.ts tests/services/entity-classifier.test.ts` — RED first after adding regression coverage, then PASS after remediation; 59 tests.
- `bunx vitest run tests/services/entity-classification-foundation.test.ts tests/services/entity-context-service.test.ts tests/services/entity-context-crud-service.test.ts tests/services/otro-persistence.test.ts tests/services/signal-collector.test.ts tests/services/entity-classifier.test.ts tests/services/conversational-integration.test.ts tests/services/conversational-service.test.ts` — PASS, 117 tests.
- `bun x tsc --noEmit` — PASS.
- `bunx vitest run tests/services/smart-classification-pr2.test.ts` — RED first on missing service modules, then PASS after implementation, 9 tests.
- `bunx vitest run tests/services/smart-classification-pr2.test.ts tests/services/entity-classification-foundation.test.ts tests/services/entity-context-service.test.ts tests/services/entity-context-crud-service.test.ts tests/services/otro-persistence.test.ts tests/services/signal-collector.test.ts tests/services/entity-classifier.test.ts tests/services/conversational-integration.test.ts tests/services/conversational-service.test.ts` — PASS, 126 tests.
- `tsc --noEmit` — FAILED in PowerShell because `tsc` is not on PATH.
- `bun x tsc --noEmit` — PASS.

## Notes / Deviations

- The current schema has no `BankRule.entityContextId` relation, so PR1 preserves BankRule data by not mutating `BankRule` rows during migration. Linked `glAccountId` remains on `EntityContext` and pending-review state makes the context reviewable.
- Local verification required `bun install` for missing dependencies and `DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/accountexpress_test?schema=public bun x prisma db push` to sync the local test database before running the new model tests.
- Critical remediation: `findContext()` now only returns confirmed contexts with a non-null role, and `collectEntityContextSignal()` refuses to create confident role/account signals unless the context is confirmed and role-bearing. SOCIO conflict helper paths were also narrowed to confirmed contexts within PR1 scope. Fresh verification is still required before changing the verify verdict from FAIL.
- PR2 added two isolated service modules and one focused test file. It does not modify API routes, confirmation endpoints, UI, or BankRule creation paths.
- `bun install --frozen-lockfile` was required in this PR2 worktree because `node_modules` was absent; the lockfile was already present and no dependency manifest changes were made.
- Maintainer approved `size:exception` for PR2 despite ~718 source/test lines because Aggregation + Classification is a cohesive dependency slice. This resolves the review-budget warning for PR2 commit/push readiness.
