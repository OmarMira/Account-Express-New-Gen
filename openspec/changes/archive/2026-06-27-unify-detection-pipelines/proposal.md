# Proposal: Unify Detection Pipelines

## Intent

9 pipelines independently normalize, detect SOCIO conflicts, and configure thresholds — producing divergent results. Unify three divergences now.

## Scope

**In**: Single `normalizePattern()` replaces 4 normalizers; SOCIO extracted to `entity-conflict-detector.ts`; one-shot migration re-normalizes `BankRule.pattern` with collision handling; pending filter uses FK `entityContextId`; central config consolidates 3 JSON files.  
**Out**: Predictive engine (Levenshtein); direction thresholds; frontend; fuzzy/exact mode.

## Capabilities

**New**: `detection-migration` (one-shot + collisions + report), `detection-config` (thresholds + per-company overrides).  
**Modified**: `rule-matching-engine` (shared normalize + SOCIO delegate), `entity-classification` (shared SOCIO + FK filter), `entity-enrichment` (SOCIO → shared service).

## Approach

1. **Normalization**: Canonical `normalizePattern()`. Replace rule-matching-engine inline version.
2. **Migration**: Re-normalize all BankRule patterns. Same GL → keep manual, deactivate. Different GL → CRITICAL + keep both.
3. **SOCIO**: `entity-conflict-detector.ts` — single `detectConflict()` replaces 3 call sites.
4. **Pending filter**: `entityContextId !== null && isActive` over pattern match. Badge.
5. **Config**: Single loader, old JSONs deprecated, per-company thresholds.

## Affected Areas

| Area | Impact |
|------|--------|
| `pattern-normalizer.ts` | Canonical normalize; deprecate old |
| `rule-matching-engine.ts` | Shared normalize + SOCIO delegate |
| `entity-classifier.ts` | Shared SOCIO; update auto-create |
| `entity-enricher.ts` | Replace `hasSocioConflict()` |
| `entity-conflict-detector.ts` | **New**: SOCIO detection |
| `pending-entities/route.ts` | FK filter + badge |
| `scripts/normalization-migration.ts` | **New**: migration script |
| `rules/*.json` (3 files) | Deprecated → central config |
| `src/lib/config/detection-config.ts` | **New**: central loader |

## Risks & Decisions

| Item | Value |
|------|-------|
| Normalization risk | Med — captured in report, DB dump rollback |
| Collision risk | Med — CRITICAL log; both stay active |
| Pending recall risk | Low — FK filter shows more, badge not hide |
| Fuzzy default | Jaro-Winkler 0.85; overridable per company |
| Collision strategy | Same GL → consolidate (keep manual). Diff GL → CRITICAL + keep both |
| Pending entities | FK filter; badge over hiding (recall > precision) |
| Config | Single source; per-company overrides |
| SOCIO order | 3 duplicates first (lower risk than direction) |
| Direction | Deferred (more files, higher risk) |

## Rollback Plan

Restore BankRule from SQL dump → `git revert` code → restore `rules/*.json` → `npx vitest`.

## Success Criteria

- [ ] Rule-matching-engine uses shared `normalizePattern()`, same match set
- [ ] Migration normalizes all patterns, produces valid report
- [ ] Same-GL collision consolidates; different-GL logs CRITICAL
- [ ] `entity-conflict-detector.ts` replaces all 3 duplicate implementations
- [ ] Pending filter uses FK `entityContextId`
- [ ] Central config loads from single source; old JSONs warn
