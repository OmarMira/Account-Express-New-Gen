# Tasks: Go-Live Validation & Hardening

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 100-150 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

## Phase 1: Test Scripts Implementation

- [x] 1.1 Create `scripts/test-predictive-engine.ts` to validate the predictive suggestions generation matching date window, exact amount, and descriptions.
- [x] 1.2 Create `scripts/test-learning-loop.ts` to validate adaptive rule generation from log feedback occurrences, direction mapping, and review status.
- [x] 1.3 Create `scripts/test-budget-engine.ts` to validate budget variance reports with actual journal lines, calculating status (CRITICAL/WARNING/OK).

## Phase 2: Package and Documentation Updates

- [x] 2.1 Bump version to `"3.0.0"` in `package.json`.
- [x] 2.2 Update `docs/GO-LIVE-CHECKLIST.md` with correct index requirement, version checks, backup/restore checks, and CI/CD gates.
