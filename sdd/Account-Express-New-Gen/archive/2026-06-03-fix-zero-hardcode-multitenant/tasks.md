# Tasks: Fix Hardcoded Fallbacks & Enforce Multitenant Isolation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 150-250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Standardize heuristics & tenancy guards | PR 1 | Base branch; tests and verification included |

## Phase 1: Foundation & Heuristics Config

- [x] 1.1 Extend `rules/assistant-config.json` with dynamic precedence, keywords, and GL account maps.
- [x] 1.2 Create `tests/services/conversational-service.test.ts` to test dynamic keyword matching and fallbacks (RED).
- [x] 1.3 Update `localHeuristicParse` in `src/lib/services/conversational-service.ts` to read config dynamically (GREEN).
- [x] 1.4 Verify `bunx vitest run tests/services/conversational-service.test.ts` passes successfully (BLUE).

## Phase 2: Multi-Tenant API Protection

- [x] 2.1 Create integration tests in `tests/integration/rbac-isolation.test.ts` for unauthorized tenant blocks (RED).
- [x] 2.2 Add tenancy checks via `db.companyMember` in `src/app/api/learning/feedback/route.ts` (GREEN).
- [x] 2.3 Add strict session tenancy checks in `src/app/api/ai-assistant/route.ts` (GREEN).
- [x] 2.4 Verify multi-tenant tests pass with `bunx vitest run tests/integration/rbac-isolation.test.ts` (BLUE).

## Phase 3: Entity Extraction & Clustering

- [x] 3.1 Create tests in `tests/services/entity-detector.test.ts` for extraction of >3 entities without slicing (RED).
- [x] 3.2 Update regex lookahead patterns inside `rules/entity-detection.json` to prevent lookahead truncating.
- [x] 3.3 Ensure `clusterCandidates` in `src/lib/services/entity-detector.ts` contains no truncation or limit checks (GREEN).
- [x] 3.4 Verify extraction tests pass with `bunx vitest run tests/services/entity-detector.test.ts` (BLUE).

## Phase 4: Full Suite Validation & Cleanup

- [x] 4.1 Run type-checker: `bun x tsc --noEmit`.
- [x] 4.2 Run linter and formatter: `bun run lint` and `bun run format`.
- [x] 4.3 Execute custom gates: `bun run scripts/test-assistant-engine.ts`.
- [x] 4.4 Create validation script `scripts/test-rbac-isolation.ts` so `bun run scripts/test-rbac-isolation.ts` passes.

## Phase 5: Dynamic Direction Exceptions (Follow-up)

- [x] 5.1 Update `rules/direction-profiles.json` to add an `allowOpposite: true` property to category `3` (Patrimonio).
- [x] 5.2 Create a Vitest test in `tests/integration/direction-profiles.test.ts` to assert that debit transactions can be mapped to Patrimonio without triggering errors (RED).
- [x] 5.3 Modify `/api/learning/conversational-parse/route.ts` to read the `allowOpposite` configuration dynamically and bypass opposition checks accordingly (GREEN).
- [x] 5.4 Verify tests pass successfully (BLUE).

