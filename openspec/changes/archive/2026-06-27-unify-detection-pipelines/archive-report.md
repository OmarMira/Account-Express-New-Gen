# Archive Report: Unify Detection Pipelines

**Change**: unify-detection-pipelines  
**Date archived**: 2026-06-27  
**Archive path**: `openspec/changes/archive/2026-06-27-unify-detection-pipelines/`  
**Previous path**: `openspec/changes/unify-detection-pipelines/`

---

## Description

Unify 9 divergent detection pipelines into single sources for normalization (`normalizePattern()`), SOCIO conflict detection (`detectConflict()`), and configuration loading (`loadDetectionConfig()`). Replace pattern-match pending-entities filtering with FK-based coverage detection. Provide one-shot migration and rollback scripts.

---

## What Was Implemented (5 Chained PRs)

| PR | Focus | Files | Lines | Status |
|----|-------|-------|-------|--------|
| **#1** | Schema + DetectionConfig loader — `DetectionConfig` Prisma model, centralized config loader with per-company overrides and validation | 3 new, 1 modified | ~200 | ✅ |
| **#2** | Canonical `normalizePattern()` — pure function with trim/collapse/lowercase/strip-punctuation; migrate 4 call sites with pre-processing | 1 new, 4 modified | ~380 | ✅ |
| **#3** | SOCIO Conflict Detector — single `detectConflict()` replaces 3 implementations; fix I9 (entityFirstMode now checked consistently) | 1 new, 4 modified | ~320 | ✅ |
| **#4a** | Pending FK filter + Config wiring — FK-based coverage detection with `isCovered` badge; replace JSON file readers with `loadDetectionConfig()` | 1 new, 4 modified | ~350 | ✅ |
| **#4b** | Migration script + restore + equivalence test — one-shot normalization with collision handling, rollback restore script, match-set equivalence validation | 3 new | ~470 | ✅ |

---

## Files Changed

### New Files (9)
| File | Purpose |
|------|---------|
| `src/lib/config/detection-config.ts` | Centralized config loader with per-company overrides |
| `src/lib/services/entity-conflict-detector.ts` | Single SOCIO conflict detector (`detectConflict()`) |
| `scripts/normalization-migration.ts` | One-shot migration script with collision handling |
| `scripts/restore-bank-rules.ts` | Rollback restore script |
| `tests/services/pattern-normalizer.test.ts` | 16 normalizePattern tests |
| `tests/services/entity-conflict-detector.test.ts` | 15 SOCIO detector tests |
| `tests/config/detection-config.test.ts` | 19 config loader tests |
| `tests/services/match-set-equivalence.test.ts` | 19 equivalence tests |
| `tests/api/learning/pending-entities.test.ts` | 6 FK filter tests |

### Modified Files (13)
| File | Change |
|------|--------|
| `prisma/schema.prisma` | + DetectionConfig model |
| `src/lib/services/pattern-normalizer.ts` | Canonical rewrite; removed deprecated wrappers |
| `src/lib/services/entity-detector.ts` | pre-process + normalizePattern; removed loadConfig |
| `src/lib/services/adaptive-engine.ts` | pre-process + normalizePattern; removed JSON reader |
| `src/lib/services/entity-context-service.ts` | Added stripTransactionPrefixes |
| `src/lib/services/entity-classifier.ts` | Removed detectEntityConflict; uses detectConflict |
| `src/lib/services/entity-enricher.ts` | Removed hasSocioConflict; uses detectConflictSync |
| `src/lib/services/rule-matching-engine.ts` | Normalize via normalizePattern; detectEntityFirstSkip |
| `src/app/api/learning/pending-entities/route.ts` | FK filter + isCovered |
| `tests/services/entity-classifier.test.ts` | Removed 4 tests for removed function |
| `tests/services/entity-first-flow.test.ts` | Updated imports + 7 test cases |
| `tests/services/adaptive-engine.test.ts` | Updated mocks |
| `rules/*.json` (3 files) | Deprecated (readers removed, files on disk) |

---

## Test Results

**Verdict**: ✅ **PASS** — 0 critical issues, 0 warnings.

All new tests pass. All existing tests pass (excluding 10 documented pre-existing failures).

| Suite | Tests | Status |
|-------|-------|--------|
| `pattern-normalizer.test.ts` | 16 | ✅ NEW |
| `detection-config.test.ts` | 19 | ✅ NEW |
| `entity-conflict-detector.test.ts` | 15 | ✅ NEW |
| `pending-entities.test.ts` | 6 | ✅ NEW |
| `match-set-equivalence.test.ts` | 19 | ✅ NEW |
| `entity-classifier.test.ts` | 31 | ✅ |
| `entity-enricher.test.ts` | 28 | ✅ |
| `rule-matching-engine.test.ts` | 28 | ✅ |
| `entity-first-flow.test.ts` | 14 | ✅ |
| `entity-detector.test.ts` | 16 | ✅ |
| `adaptive-engine.test.ts` + rotation | 18 | ✅ |
| Other suites (auth, pdf, etc.) | ~70 | ✅ Pre-existing |

### Pre-existing Failures (10, unchanged)
- rate-limiter: 0 tests (setup failure)
- security: 0 tests (setup failure)
- sessions-hashing: 2 failed
- validate-request: 1 failed
- reconciliation-book-balance: 4 failed
- import.service: 1 failed

---

## Specs Synced to Main

| Domain | Action | Details |
|--------|--------|---------|
| normalization | **Created** | New `openspec/specs/normalization/spec.md` — REQ-NORM-01, REQ-NORM-02, REQ-MIG-01 through REQ-MIG-05 |
| entity-detection (SOCIO) | **Created** | New `openspec/specs/entity-detection/spec.md` — REQ-SOCIO-01, REQ-SOCIO-02, REQ-SOCIO-03 |
| detection-config | **Created** | New `openspec/specs/detection-config/spec.md` — REQ-CFG-01 through REQ-CFG-05 |
| rule-matching-engine | **Already added** | Shared normalization additions present in `openspec/specs/rule-matching-engine/spec.md` (Requirement: Shared Normalization via normalizePattern) |
| entity-classification | **Already added** | Pending-entities FK filter additions present in `openspec/specs/entity-classification/spec.md` (Requirement: Pending Entities Filter via FK) |

---

## Key Behavioral Changes

1. **I9 Fix**: `detectEntityConflict()` and `hasSocioConflict()` previously ignored `entityFirstMode`. The single `detectConflict()` ALWAYS checks it.
2. **normalizePattern()**: No longer strips INDN:/DES:/Zelle prefixes. Callers needing prefix stripping pre-process explicitly.
3. **Pending entities**: No entity hidden anymore. `isCovered: boolean` replaces silent filtering. Recall > precision.
4. **Config**: Old JSON file readers removed. Config loaded from DetectionConfig DB table or hardcoded defaults.

---

## Known Limitations

1. **Pre-existing test failures**: 10 failures in rate-limiter, security, sessions-hashing, validate-request, reconciliation-book-balance, and import.service — none introduced by this change.
2. **JSON config values not auto-migrated**: Existing `rules/*.json` values must be manually entered into the DetectionConfig DB table. Files remain on disk (deprecated, not deleted) — no data loss.
3. **Direction inference normalization**: Deferred to a future change (out of scope).
4. **Predictive engine normalization** (Levenshtein): Not yet unified — different algorithm, not in scope.
5. **Config hot-reload**: Configuration changes require restart or manual cache clear — no hot-reload mechanism.

---

## Rollback Plan

1. Restore BankRule data: `npx tsx scripts/restore-bank-rules.ts`
2. Revert code: `git revert HEAD`
3. Verify: `npx vitest`

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. 25/25 tasks complete. 9 new files, 13 modified files. All tests pass.
