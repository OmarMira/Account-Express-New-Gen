# Proposal: Consolidate Bank Rules Engine

## Intent

Three matching engines (rule-matching-engine.ts, import.service.ts, entity-classifier.ts) produce divergent results for the same input. The 5000-tx apply cap is silent, and PUT skips duplicate validation. This unifies matching, surfaces limits, fixes PUT dedup.

## Scope

### In Scope
- Canonical engine: case-insensitive + trimmed with role-priority scoring
- import.service.ts + entity-classifier.ts delegate to unified engine
- PUT /api/bank-rules/[id] duplicate check
- Async cached loadRolePriorities()
- Configurable per-company cap with warning
- Unit + integration tests

### Out of Scope
- UI V2 multi-condition support (RuleCondition[]) — deferred
- Role priority UI configuration — deferred (JSON config suffices)

## Capabilities

### New Capabilities
- `rule-matching-engine`: Canonical case-insensitive + trimmed matching replacing three diverging implementations, with role-priority scoring.
- `transaction-apply-limits`: Configurable per-company transaction caps with user-facing overflow warnings when caps are hit.

### Modified Capabilities
None — no existing `openspec/specs/` to modify.

## Approach

Consolidate all matching into rule-matching-engine.ts with lowercase + trim normalization. Add a CompanySetting (or extend existing model) for maxApplyTransactions. The apply-all route reads the cap and returns a warning payload when exceeded. Add unique constraint check to PUT handler. Replace readFileSync with fs.promises + TTL cache. Wire import.service.ts and entity-classifier.ts to call the unified engine.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/services/rule-matching-engine.ts` | Modified | Becomes the canonical matching engine |
| `src/lib/services/import.service.ts` | Modified | Delegates matching to unified engine |
| `src/lib/services/entity-classifier.ts` | Modified | Delegates matching to unified engine |
| `src/app/api/bank-rules/[id]/route.ts` | Modified | Adds PUT duplicate validation |
| `src/app/api/bank-rules/apply-all/route.ts` | Modified | Configurable cap + warning |
| `src/lib/services/role-priorities.ts` | Modified | Async cached loading |
| `prisma/schema.prisma` | Modified | Company-level cap field |
| `tests/` | New | Unit + integration for engine |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Edge cases from 3-engine unification cause regressions | Medium | Stage-compare old vs new results; keep common behavior canonical |
| Exceeds 400-line budget | High | Recommend chained PRs: (1) engine unification, (2) cap+dedup+async, (3) tests |

## Rollback Plan

Revert to per-engine implementations. No data migration needed — the engine is computation-only. Revert Prisma schema changes if the model was modified.

## Dependencies

None — all changes are internal to the Bank Rules module.

## Success Criteria

- [ ] Unified engine matches or improves results for all existing rules across all three consumers
- [ ] PUT /api/bank-rules/[id] rejects duplicates with 409
- [ ] Apply-all shows warning when capped, no silent truncation
- [ ] loadRolePriorities() never blocks the event loop
- [ ] New tests pass with >90% coverage on the unified engine
