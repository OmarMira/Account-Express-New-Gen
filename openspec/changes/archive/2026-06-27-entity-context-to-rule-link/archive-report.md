# Archive Report: entity-context-to-rule-link

**Archived**: 2026-06-27

## Description

Auto-create a matching BankRule on entity classification so Apply All works immediately. Classifying an entity previously stored metadata only — Apply All ignored it because no BankRule existed. This change links EntityContext to BankRule via FK, auto-creates rules with inferred direction, and handles lifecycle (manual edits, deletion nullification).

## What Was Implemented

- Added `entityContextId` (FK) and `isManuallyEdited` fields to BankRule schema
- Modified `classifyEntity()` to auto-create a BankRule after saving EntityContext, with dedup logic (active→skip, inactive→reactivate, manual→untouched)
- Implemented `computeDirectionProfile()` — infers transaction direction from historical data (>80% threshold)
- Implemented `autoCreateRule()` with Prisma `$transaction` to prevent race conditions
- Modified PATCH `/api/bank-rules/[id]` to set `isManuallyEdited=true` on non-isActive field changes
- Exposed `entityContextId` in GET `/api/bank-rules` responses
- Modified `removeEntityContext()` and `bulkRemoveEntityContexts()` to nullify FK before deleting EntityContext, with audit logging
- Updated `classify-entity` route to surface `warning` field in API response

## Files Changed

- `prisma/schema.prisma` — Added `entityContextId String?` and `isManuallyEdited Boolean @default(false)` to BankRule model
- `src/lib/services/entity-classifier.ts` — Changed return type, added `autoCreateRule()` and `computeDirectionProfile()`
- `src/lib/services/entity-context-crud-service.ts` — FK nullification before delete in `removeEntityContext()` and `bulkRemoveEntityContexts()`
- `src/app/api/bank-rules/[id]/route.ts` — Differential PATCH, GET includes `entityContextId`
- `src/app/api/bank-rules/route.ts` — GET includes `entityContextId`
- `src/app/api/learning/classify-entity/route.ts` — Surface `warning` in response
- `src/app/api/entity-context/[id]/route.ts` — Updated delete logic

## Test Results

- **72 tests passing**, 0 failed, 0 skipped
- **3 test files**: entity-classifier.test.ts, entity-context-crud-service.test.ts, bank-rules/id-route.test.ts
- **15/15 spec scenarios compliant**
- **Build**: ✅ Passed

## Artifacts

| Artifact | Status |
|----------|--------|
| proposal.md | ✅ Archived |
| design.md | ✅ Archived |
| specs/entity-classification/spec.md | ✅ Merged to main spec |
| specs/rule-matching-engine/spec.md | ✅ Merged to main spec |
| tasks.md | ✅ Archived (25/25 tasks completed) |
| verify-report.md | ✅ Archived (PASS) |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| Entity Classification | Updated | 1 requirement added (Auto-Create BankRule on Classification) with 7 scenarios |
| Rule Matching Engine | Updated | 3 requirements added (BankRule Schema Extensions, Differential PATCH, FK Nullification) with 6 scenarios |

## Known Limitations / Pre-existing Failures

- **SUGGESTION**: Schema includes `onDelete: SetNull` on the BankRule-EntityContext relation, which is a DB-level safety net beyond the design's manual nullification. Consider documenting this in the design or spec to avoid confusion.
- No coverage tool was run; test coverage metrics are unavailable.
- Direction profile queries BankTransaction descriptions with a loose `contains` match — may benefit from pattern normalization (`normalizePattern()`) in the future.

## Verdict

**ARCHIVED** — change closed. All spec deltas merged to main specs. Source of truth updated. No further action required.
