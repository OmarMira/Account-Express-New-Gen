# Proposal: Entity Classification & Bank Rules Overhaul

## Intent

Fix type gaps, dead code, endpoint confusion, and missing tests in entity classification and bank rules. No breaking changes — staged as quick wins → integration → cleanup.

## Scope

### In Scope
- BankRulesPage local types: add V2 fields (`conditions`, `debitGlAccountId`, `creditGlAccountId`)
- `entity-context-crud-service.ts`: remove `any` casts (lines 17, 43)
- Tests for `handleSave()` V2 payload shape and `conditions[]` validation edge cases
- Endpoint purpose documentation (`/api/bank-rules` vs `/api/learning/rules`)
- Connect `EntityOnboardingModal` to `/api/learning/smart-classify` (currently uses old `classify-entity` endpoint)
- Remove dead code: `WizardDialog`, `wizard-store.ts`, `wizard-service.ts`, wizard barrel
- Remove `EntityOnboardingModal` after wizard integration replaces it OR keep and upgrade

### Out of Scope
- Role registry consolidation (already covered by entity-classification spec)
- Manual entity creation (already spec'd)
- Dual detection engine merge (deferred to future change)

## Capabilities

### Modified Capabilities
- `entity-classification`: update candidate fetching endpoint from `classify-entity` to `smart-classify`
- `rule-matching-engine`: add V2 field types to frontend BankRule type (no engine logic change)

## Approach

**Phase 1 — Type fixes + tests (no behavior change):** Fix BankRule/RuleForm types, remove `any` in crud service, add V2 payload tests. Zero risk.

**Phase 2 — Integration:** Upgrade EntityOnboardingModal to fetch from `smart-classify`. Endpoint doc: `/api/bank-rules` = pure rule CRUD, `/api/learning/rules` = atomic rule + entity context creation.

**Phase 3 — Cleanup:** Remove dead wizard code, remove EntityOnboardingModal after verifying new flow.

## Affected Areas

| Area | Impact | Changes |
|------|--------|---------|
| `src/components/spa/BankRulesPage.tsx` | Modified | Add V2 fields to BankRule, RuleForm types |
| `src/lib/services/entity-context-crud-service.ts` | Modified | Replace `as any` with proper types |
| `src/components/learning/EntityOnboardingModal.tsx` | Modified | Switch candidate fetch to `smart-classify` |
| `src/components/wizard/*` | Removed | Dead code: WizardDialog, 3 steps, store, service |
| `src/lib/stores/wizard-store.ts` | Removed | Only used by dead wizard |
| `src/lib/services/wizard-service.ts` | Removed | Only used by dead wizard |
| `tests/components/BankRulesPage.test.tsx` | Extended | V2 payload + conditions validation tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Removing dead code breaks something | Low | Search full repo for imports before deleting |
| EntityOnboardingModal changes affect rule creation | Medium | Keep classify-entity endpoint alive during migration |
| Type fix reveals TS errors in callers | Low | Fix in same PR — compiler catches them |

## Rollback Plan

Each phase is an autonomous PR on the feature branch chain. Revert the PR for that phase. Phase 1 types are additive (no rollback needed). Phase 2: old endpoint stays active, revert the fetch URL change. Phase 3: restore deleted files from git.

## Dependencies

- Existing specs: `openspec/specs/entity-classification/spec.md`, `openspec/specs/rule-matching-engine/spec.md`

## Success Criteria

- [ ] BankRulesPage local types include `conditions`, `debitGlAccountId`, `creditGlAccountId`
- [ ] Zero `any` casts in `entity-context-crud-service.ts`
- [ ] `handleSave()` payload in tests asserts V2 shape
- [ ] EntityOnboardingModal fetches from `/api/learning/smart-classify`
- [ ] No dead wizard code remains after Phase 3
- [ ] All existing tests pass
