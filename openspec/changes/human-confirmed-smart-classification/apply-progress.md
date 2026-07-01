# Apply Progress: Human-Confirmed Smart Classification — PR1 Foundation

## Scope

Implemented PR1 only: schema, migration, state constants/types/helpers, focused tests, and OpenSpec task status. PR2/PR3 aggregation, LLM prompt, confirmation endpoint, rules learning, and UI work remain untouched.

## Completed Tasks

- [x] 1.1 Add/verify Prisma fields for nullable role, `classificationStatus`, confidence/suggestion metadata, and migration rollback counts.
- [x] 1.2 Write migration converting legacy `EntityContext.role = 'OTRO'` to `role = null` + `PENDING_REVIEW`, preserving `pattern`, `userDescription`, `glAccountId`, timestamps, and linked `BankRule` references.
- [x] 1.3 Ensure migrated OTRO contexts never create, activate, delete, deactivate, or overwrite BankRules automatically; surface linked rule/account for review.
- [x] 1.4 Add model/schema tests proving nullable role, classification state, confidence storage, and legacy OTRO migration safety.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/services/entity-classification-foundation.test.ts` | Service/model | ✅ 49/49 existing entity context tests passed before changes | ✅ New tests failed on null role/status/confidence | ✅ New focused tests passed after schema/service update | ✅ Pending-review null role and confirmed confidence cases | ✅ Constants/types kept minimal |
| 1.2 | `tests/services/entity-classification-foundation.test.ts` | Unit/migration artifact | N/A (new migration) | ✅ Migration file assertions failed while file was absent | ✅ Migration content assertions passed | ✅ OTRO conversion plus field-preservation assertions | ➖ None needed |
| 1.3 | `tests/services/entity-classification-foundation.test.ts` | Unit/migration artifact + service/model | ✅ Existing behavior covered by focused regression suite | ✅ BankRule no-mutation assertion failed while migration was absent | ✅ Assertion passed; service preserves linked `glAccountId` in pending review state | ✅ Linked account preservation and BankRule non-mutation cases | ➖ None needed |
| 1.4 | `tests/services/entity-classification-foundation.test.ts` | Service/model | ✅ 49/49 baseline tests passed | ✅ New coverage failed before implementation | ✅ 5/5 new tests and 59/59 focused regression tests passed | ✅ Nullable role, pending status, confirmed status, confidence, linked account, migration safety | ✅ No broad PR2/PR3 behavior added |

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

## Notes / Deviations

- The current schema has no `BankRule.entityContextId` relation, so PR1 preserves BankRule data by not mutating `BankRule` rows during migration. Linked `glAccountId` remains on `EntityContext` and pending-review state makes the context reviewable.
- Local verification required `bun install` for missing dependencies and `DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/accountexpress_test?schema=public bun x prisma db push` to sync the local test database before running the new model tests.
- Critical remediation: `findContext()` now only returns confirmed contexts with a non-null role, and `collectEntityContextSignal()` refuses to create confident role/account signals unless the context is confirmed and role-bearing. SOCIO conflict helper paths were also narrowed to confirmed contexts within PR1 scope. Fresh verification is still required before changing the verify verdict from FAIL.
