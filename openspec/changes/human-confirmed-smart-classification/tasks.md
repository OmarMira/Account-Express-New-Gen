# Tasks: Human-Confirmed Smart Classification

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900-1400 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Foundation -> PR2 Aggregation + Classification -> PR3 Confirmation + Rules + UI |
| Delivery strategy | force-chained / user-approved chained PRs |
| Chain strategy | stacked-to-main; user-selected for this change |
| PR2 size decision | `size:exception` maintainer-approved; PR2 is ~718 source/test lines, above the 400-line budget, but Aggregation + Classification remains one cohesive review unit because the classifier depends on the aggregator and splitting them would create artificial dependency overhead |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
PR2 size exception: Approved by maintainer for Aggregation + Classification; 126 focused tests passed, typecheck passed, and fresh verify found no CRITICALs. PR2 may proceed to commit/push with this exception documented.

### Chain Strategy

User chose `stacked-to-main`: PR1 branches from the current clean main/tracker base and merges to main first. After PR1 is merged, deployed, and verified, PR2 starts from updated main; after PR2 is merged, deployed, and verified, PR3 starts from updated main. Each PR must be independently deployable and reversible.

## PR1: Foundation (Schema, Migration, State)

- [x] 1.1 Add/verify Prisma fields for nullable role, `classificationStatus`, confidence/suggestion metadata, and migration rollback counts.
- [x] 1.2 Write migration converting legacy `EntityContext.role = 'OTRO'` to `role = null` + `PENDING_REVIEW`, preserving `pattern`, `userDescription`, `glAccountId`, timestamps, and linked `BankRule` references.
- [x] 1.3 Ensure migrated OTRO contexts never create, activate, delete, deactivate, or overwrite BankRules automatically; surface linked rule/account for review.
- [x] 1.4 Add model/schema tests proving nullable role, classification state, confidence storage, and legacy OTRO migration safety.

### PR1 Acceptance Criteria

- PR1 is independently functional and deployable without PR2/PR3.
- Migration failure blocks downstream work; rollback/recovery is documented and safe.
- Previous behavior is preserved; no user-confirmed data or unconfirmed rules are overwritten.

## PR2: Aggregation + Classification

- [x] 2.1 Create `src/lib/services/entity-history-analyzer.ts` with transaction count, total, active months, direction percentages, recurrence, amount stats, descriptions, prior context/rules.
- [x] 2.2 Add tests for multi-transaction aggregation, single-transaction cold-start summaries, mixed direction, recurrence labels, and preserved legacy `userDescription` context.
- [x] 2.3 Create `src/lib/services/smart-entity-classifier.ts` with generic runtime prompt builder, heuristic role/intent suggestions, confidence scoring, and one review question on insufficient evidence.
- [x] 2.4 Test prompt construction contains runtime tenant/entity summary only; no hardcoded sample names, amounts, or documentation examples.
- [x] 2.5 Implement cold-start and re-evaluation lifecycle: history can suggest pending updates, but confirmed classifications remain authoritative.

## PR3: Confirmation + Rules + UI

- [x] 3.1 Update `src/app/api/learning/smart-classify/route.ts` to return enriched suggestions for new and migrated pending entities.
- [x] 3.2 Reuse/retire `src/app/api/learning/suggest-role/route.ts` behind the smart classifier service without duplicating prompt/parsing logic.
- [x] 3.3 Update `src/lib/services/entity-classifier.ts` so only explicit confirmation with role, intent, and GL account can create/update BankRules.
- [x] 3.4 Update `src/components/learning/EntityOnboardingModal.tsx` only after coordinating dirty work; show pending-review badge/surfacing, confidence, explanation, linked rule/account warnings, and one plain-language question.
- [x] 3.5 Learn from confirmed corrections for future similar entities while keeping every future automation confirmation-gated.
- [x] 3.6 Extend integration/component tests for confirmation endpoint, safe rule creation, pending-review UI, legacy OTRO review, linked BankRule safety, and correction learning.
- [x] 3.7 Run strict TDD command: `bun x vitest --reporter=verbose --no-file-parallelism`; then type-check with `npx tsc --noEmit`.
