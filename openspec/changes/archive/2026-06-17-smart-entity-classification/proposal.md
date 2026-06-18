# Proposal: Smart Entity Classification

## Intent

4 tightly coupled issues degrade entity data quality: (1) any string passes as role — no enum validation; (2) assigned role and transaction direction profile are never compared; (3) mixed-direction entities (both debits and credits) can't be split; (4) OTRO stores free text directly as the role instead of suggesting a canonical one.

## Scope

### In Scope
- **F1**: Role validation via `z.enum(ENTITY_ROLES)` on all 4 creation paths
- **F2**: Direction-vs-role mismatch warning (non-blocking) on role assignment
- **F3**: Frontend split of mixed-direction entities into 2 EntityContext records
- **F4**: Lightweight AI suggestion endpoint + debounced toast on OTRO free-text input

### Out of Scope
- Backend-driven auto-split with AI (future enhancement)
- Retroactive migration of existing OTRO free-text roles (handled via nullish coalescing on read)
- Direction mismatch as hard block (always a warning, user overrides)

## Capabilities

### Modified Capabilities
- `entity-classification`: Role validation changes from `z.string()` to `z.enum(ENTITY_ROLES)`; OTRO now stores canonical "OTRO" as role + free text as description
- `entity-enrichment`: `ROLE_ACCOUNT_MAP` gains `expectedDirection` field; `resolveDirection()` uses role→direction mapping

### New Capabilities
- `entity-direction-mismatch`: Warning system comparing assigned role's expected direction vs entity's transaction direction profile
- `entity-split`: Frontend split of mixed-direction candidates into separate EntityContext records
- `entity-role-suggestion`: Lightweight AI endpoint + toast UI for OTRO free-text role analysis

## Approach

| Feature | Approach | Key Files |
|---------|----------|-----------|
| F1 | Change `role: z.string() → entityRoleSchema` in entity-context.ts; add Zod schema to PATCH `[id]/route.ts` | entity-context.ts, `[id]/route.ts` |
| F2 | Add `expectedDirection` to `ROLE_ACCOUNT_MAP`; shared `checkRoleDirectionMismatch()`; UI warning banner | role-account-map.ts, EntityOnboardingModal, EntityManagementPage |
| F3 | Detect mixed (both debit+credit >15%) in EntityOnboardingModal; offer "Split into 2" creating separate records | EntityOnboardingModal.tsx |
| F4 | New `POST /api/learning/suggest-role` → `parseWithAI()`; 1s debounce on free-text input → toast with "Assign" | suggest-role/route.ts, EntityOnboardingModal.tsx |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `entity-context.ts` | Modified | Schema: `z.string` → `entityRoleSchema` |
| `[id]/route.ts` | Modified | Add Zod validation to PATCH body |
| `role-account-map.ts` | Modified | Add `expectedDirection` per role |
| `entity-enricher.ts` | Modified | Mismatch detection logic |
| `suggest-role/route.ts` | **New** | Lightweight AI suggestion endpoint |
| `EntityOnboardingModal.tsx` | Modified | F2 warning + F3 split + F4 toast |
| `EntityManagementPage.tsx` | Modified | F2 direction mismatch warning |
| `classify-entity/route.ts` | Modified | Add role validation before classifyEntity() |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OTRO backward compat — existing free-text roles break on update | High | Nullish coalescing on read; DB migration maps old values to "OTRO" |
| AI cost from keystroke-triggered calls | Med | 1s debounce, min 5 chars, optional daily limit |
| False positives for SOCIO (legitimately has both directions) | Med | Warning is non-blocking; user can always override |
| Split creates duplicate entities for same pattern | Low | Backend detects existing entity for same pattern+direction; suggests merge |

## Rollback Plan

1. Revert `entity-context.ts` schema to `z.string().min(1).max(50)`
2. Revert `[id]/route.ts` — remove Zod validation
3. Revert `ROLE_ACCOUNT_MAP` — remove `expectedDirection`
4. Delete `suggest-role/route.ts`
5. Revert EntityOnboardingModal and EntityManagementPage
6. Rollback order: components → routes → schemas (safe at each step)

## Success Criteria

- [ ] All 4 creation paths reject non-canonical roles with clear error
- [ ] Direction mismatch warning appears when role conflicts with entity's transaction profile
- [ ] Mixed entities can be split into 2 EntityContext records via modal UI
- [ ] OTRO free text triggers AI suggestion toast within 2s of typing stop
- [ ] Existing test suite passes; new tests cover mismatch detection and split logic
