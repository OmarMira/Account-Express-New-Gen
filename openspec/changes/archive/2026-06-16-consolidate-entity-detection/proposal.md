# Proposal: Consolidate Entity Detection Engines

## Intent

Two detection engines (`entity-detector.ts` Jaro-Winkler fuzzy vs `ai-rules/scan` exact normalize+count) produce **different candidates** from the same transactions. Users see inconsistent suggestions depending on which UI they use. Consolidation ensures deterministic, consistent output everywhere.

## Scope

### In Scope
1. Expand `clusterCandidates()` with `mode` option (fuzzy|exact)
2. Extract enrichment (GL account suggestion, context role) into `entity-enricher.ts`
3. Refactor scan route as thin orchestrator
4. Tests for scan route (currently 0) + enricher
5. Harmonize min-occurrence thresholds and role-filtering

### Out of Scope
- Role registry (Phase 1 done)
- Entity classifier tests (Phase 1 done)
- Silent candidate filtering UX
- Bulk CSV import

## Capabilities

### New Capabilities
- `entity-enrichment`: Reusable GL account suggestion + context role resolution + direction profile, extracted from scan route.

### Modified Capabilities
- `entity-classification`: Detection algorithm changes. Clustering gains configurable mode (fuzzy|exact). Enriched output fields added.

## Approach

1. `clusterCandidates(config)` → `clusterCandidates(config, { mode: 'fuzzy' | 'exact' })`. Exact mode = normalized key match (current scan behavior). Fuzzy = Jaro-Winkler 0.85 (unchanged).
2. `entity-enricher.ts`: Pure functions for GL account suggestion (keyword → ROLE_ACCOUNT_MAP → fallback), context role lookup, direction profile.
3. Scan route: fetch txs → unified engine → enrich → return `{ patterns }`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `entity-detector.ts` | Modified | Add mode param |
| `entity-enricher.ts` | New | Enrichment logic |
| `scan/route.ts` | Modified | Thin orchestrator |
| `entity-detector.test.ts` | Modified | Mode + enrichment tests |
| `entity-enricher.test.ts` | New | Unit tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scan output changes break ConversationalRuleBuilder | Low | Keep `ScanPattern` interface identical |
| Exact mode differs from current scan on edge cases | Medium | Preserve normalize+count as default exact logic |
| Perf regression from enrichment | Low | Run enrichment per candidate, not per tx |

## Rollback Plan

Revert `entity-detector.ts`, revert `scan/route.ts`, delete `entity-enricher.ts`. No DB changes — pure service-layer.

## Dependencies

- `ROLE_ACCOUNT_MAP`, `entity-context` services exist (Phase 1)
- `entity-classification` spec stable

## Success Criteria

- [ ] Scan route output type-identical (same `ScanPattern` shape)
- [ ] All existing detector tests pass + new exact-mode tests
- [ ] `clusterCandidates(mode: 'exact')` matches current scan results on ≥5 real tx sets
