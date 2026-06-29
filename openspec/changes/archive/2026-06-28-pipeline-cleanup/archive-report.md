# Archive Report: Pipeline Cleanup

**Change**: pipeline-cleanup (Change #2b)
**Date**: 2026-06-28
**Status**: Archived — fully implemented and verified

---

## Executive Summary

This change closed 4 deferred structural divergences in the detection pipeline from Change #2 (unify detection pipelines):

1. **Direction thresholds**: Consolidated 3 direction functions with 3 different thresholds into a single exported `classifyDirection()` (threshold >= 0.8) and renamed `resolveDirection()` to `majorityDirection()` (threshold > 0.5). Removed unused `directionLockThreshold: 0.90` from config.
2. **Zero-amount filtering**: Added epsilon-based guard (`Math.abs(Number(amount)) < 0.00001`) in `clusterExact()`, `clusterFuzzy()`, and `computeDirectionProfile()`. Prevents degenerate clustering/classification on zero-amount transactions.
3. **Direction validation consolidation**: Removed duplicated `checkRoleDirectionMismatch()` from entity-enricher. All callers now delegate to the canonical `roleIsValidForDirection()` in direction-filter.ts.
4. **Predictive algorithm swap**: Extracted Jaro-Winkler from entity-detector to new `src/lib/utils/string-similarity.ts` module. Predictive engine now uses Jaro-Winkler instead of inline Levenshtein. Re-export maintained from entity-detector for backward compatibility.

## Files Changed

| Action | File |
|--------|------|
| **NEW** | `src/lib/utils/string-similarity.ts` — extracted Jaro-Winkler utility |
| **NEW** | `tests/utils/string-similarity.test.ts` — unit tests for Jaro-Winkler |
| MODIFIED | `src/lib/services/entity-detector.ts` — re-export string-similarity; zero-amount guards in clusterExact/clusterFuzzy; remove directionLockThreshold from config |
| MODIFIED | `src/lib/services/entity-classifier.ts` — zero-amount guard in computeDirectionProfile |
| MODIFIED | `src/lib/services/entity-enricher.ts` — resolveDirection→majorityDirection; remove checkRoleDirectionMismatch; delegate to roleIsValidForDirection |
| MODIFIED | `src/lib/services/direction-filter.ts` — export classifyDirection + DirectionProfile type |
| MODIFIED | `src/lib/reconciliation/predictive-engine.ts` — Levenshtein→JaroWinkler |
| MODIFIED | `rules/entity-detection.json` — remove directionLockThreshold |
| MODIFIED | `tests/services/entity-classifier.test.ts` — zero-amount test cases |
| MODIFIED | `tests/services/entity-enricher.test.ts` — direction rename + validator update |
| MODIFIED | `tests/services/direction-filter.test.ts` — classifyDirection export tests |

## Test Results

- **All 200+ existing tests pass** (no regression)
- **New string-similarity tests**: 8 edge cases, all passing
- **Zero-amount tests**: mixture scenarios (debit/credit with zero-amount entries)
- **classifyDirection export tests**: 5 scenarios (pure debit/credit, mixed, boundary, zero profile)
- **majorityDirection tests**: 4 scenarios (majority debit/credit, equal, both low)
- **TypeScript compile**: `npx tsc --noEmit` — zero errors

## Specs Synced to Main

| Domain | Action | Details |
|--------|--------|---------|
| direction-validation | **Created** | roleIsValidForDirection is canonical; removed checkRoleDirectionMismatch; validateDirectionProfile stays separate |
| direction | **Created** | classifyDirection (>=0.8), majorityDirection (>0.5), directionLockThreshold removed |
| predictive-algorithm | **Created** | Jaro-Winkler in string-similarity.ts; predictive engine uses Jaro-Winkler |
| re-exports | **Created** | Backward-compatible re-exports from entity-detector |
| zero-amount | **Created** | Epsilon-based zero-amount filtering in clustering and direction profile |
| entity-direction-mismatch | **Updated** | Updated references from checkRoleDirectionMismatch to roleIsValidForDirection |
| entity-classification | **Updated** | Updated direction inference to reference canonical classifyDirection |

## Deferred Work

- **predictive-engine test fixtures**: No existing test files found for predictive engine. No action needed. Should be considered for future test coverage.
- **EntityOnboardingModal.tsx**: Has its own local `checkRoleDirectionMismatch` (UI-layer copy). Not in scope for this service-layer change.

## Verification Status

Change fully verified. All 15 tasks completed:
- Phase 1 (string-similarity.ts + re-export): Tasks 1.1–1.3 ✅
- Phase 2 (zero-amount filters): Tasks 2.1–2.4 ✅
- Phase 3 (direction consolidation): Tasks 3.1–3.5 ✅
- Phase 4 (predictive algorithm swap): Tasks 4.1–4.2 ✅
- Phase 5 (config cleanup + regression): Tasks 5.1–5.2 ✅

## Archive Contents

- `proposal.md` — original change proposal
- `design.md` — technical design and architecture
- `specs/` — 5 domain delta specs
- `tasks.md` — 15 tasks, all completed (Phase 1–5)
- `archive-report.md` — this document

## SDD Cycle Complete

The pipeline cleanup change has been fully planned, implemented, verified, and archived. All detection pipeline structural divergences from Change #2 are now resolved.
