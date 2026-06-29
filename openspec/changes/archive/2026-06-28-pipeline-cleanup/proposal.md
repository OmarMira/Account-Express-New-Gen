# Proposal: Pipeline Cleanup (Change #2b)

## Intent

The detection pipeline unification (Change #2) resolved 11 inconsistencies but deferred 4 structural divergences: direction thresholds (3 functions, 3 thresholds), zero-amount handling (inconsistent across pipelines), direction validation (duplicated x3), and predictive algorithm mismatch (Levenshtein vs Jaro-Winkler vs contains). This change cleans those 4 items to close the detection unification chapter.

## Scope

### In Scope

1. **Direction thresholds**: Consolidate `computeDirectionProfile()` (>0.8), `resolveDirection()` (>0.5), `classifyDirection()` (>=0.8) into a single `classifyDirection()` with `DIRECTION_THRESHOLD = 0.8`. Rename `resolveDirection()` to `majorityDirection()` (threshold 0.5 — different question: "majority" vs "pure"). Remove unused `directionLockThreshold: 0.90` from config.
2. **Zero-amount filter**: Add `if (Math.abs(Number(amount)) < 0.00001) continue;` in `clusterExact()`, `clusterFuzzy()`, and `computeDirectionProfile()`. Add tests for zero-amount edge cases.
3. **Direction validation consolidation**: `roleIsValidForDirection()` (direction-filter.ts) becomes the canonical validator. `checkRoleDirectionMismatch()` (entity-enricher.ts) calls it internally or is removed. `validateDirectionProfile()` stays separate (different domain: GL account class).
4. **Predictive algorithm**: Extract Jaro-Winkler from `entity-detector.ts` to `src/lib/utils/string-similarity.ts`. Use Jaro-Winkler in `predictive-engine.ts` replacing Levenshtein. Re-export `jaroWinkler` from `entity-detector.ts` for backward compat.

### Out of Scope
- Safe Apply All (Change #3 — next)
- Direction threshold value changes (same 0.8/0.5 split, just codified)
- Full predictive engine rewrite (just algorithm swap)

## Capabilities

**New**: `src/lib/utils/string-similarity.ts` — shared Jaro-Winkler + string matching utilities.

**Modified**: All 4 pipelines converge on consistent zero-amount handling, unified direction threshold functions, deduplicated direction validation.

## Approach

1. **string-similarity.ts**: Extract `jaroWinkler()` + `jaro()` from entity-detector. Re-export from entity-detector.
2. **direction-profiles.ts** (new, or extend existing): Consolidate classifyDirection/resolveDirection/majorityDirection. Remove unused directionLockThreshold.
3. **Zero-amount guard**: Add epsilon-based filter in 3 clustering/classification loops. Tests.
4. **roleIsValidForDirection canonical**: Remove checkRoleDirectionMismatch, delegate to canonical.
5. **predictive-engine.ts**: Replace Levenshtein with Jaro-Winkler import.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/utils/string-similarity.ts` | **New** | Jaro-Winkler extracted from entity-detector |
| `src/lib/services/entity-detector.ts` | Modified | Re-export jaroWinkler; zero-amount filter |
| `src/lib/services/entity-classifier.ts` | Modified | Zero-amount filter in computeDirectionProfile |
| `src/lib/services/entity-enricher.ts` | Modified | checkRoleDirectionMismatch → canonical |
| `src/lib/services/direction-filter.ts` | Modified | Export classifyDirection as canonical |
| `src/lib/services/direction-validation.ts` | Unchanged | Separate concern, stays as-is |
| `src/lib/reconciliation/predictive-engine.ts` | Modified | Levenshtein → Jaro-Winkler |
| `src/lib/semantic-validator.ts` | Unchanged | Orphaned, no change |
| `rules/entity-detection.json` | Modified | Remove directionLockThreshold |
| `tests/*` | Multiple | Zero-amount + direction tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Zero-amount epsilon too large | Low | 0.00001 is safe for currencies (minimum unit 0.01) |
| Levenshtein → Jaro-Winkler changes match results | Medium | Equivalence test: verify no regression on known fixtures |
| Re-export from entity-detector causes circular imports | Low | Re-export is a passthrough, no circular dependency risk |

## Success Criteria

- [ ] `classifyDirection()` (0.8) used by all direction-purity callers
- [ ] `majorityDirection()` (0.5) clearly named, used by enrichment
- [ ] Zero-amount transactions excluded from clustering and direction profile
- [ ] `roleIsValidForDirection()` is the single direction-role validator
- [ ] Predictive engine uses Jaro-Winkler, same-or-better match quality
- [ ] All existing tests pass (no regression in 200+ test suite)
