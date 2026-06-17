# Proposal: Improve Entity Classifier

## Intent

Fix the missing OTRO role bug in entity classification, enable manual entity creation from UI, consolidate role sources into one shared constant, and add test coverage to `entity-classifier.ts`.

## Scope

### In Scope
1. Fix `rules/entity-roles.json` — add all 11 roles (INQUILINO, PROVEEDOR, SOCIO, CLIENTE, EMPLEADO, TARJETA_CREDITO, PRESTAMO, GASTO_OPERATIVO, INGRESO, OTRO). IGNORADA is internal only, excluded from JSON.
2. Extract shared role constant consolidating `ROLE_ACCOUNT_MAP` + `entity-roles.json` + hardcoded ROLES from EntityManagementPage into one source of truth.
3. Add Zod enum validation for entity roles in `entity-context.ts`.
4. Add "Add Entity" button + dialog form with GL account selector in EntityManagementPage.
5. Add POST `/api/learning/entities` route for manual entity creation.
6. Unit tests for `entity-classifier.ts` (currently 0 coverage).
7. i18n keys for all new UI strings (manual creation flow).

### Out of Scope
- Detection engine consolidation (`entity-detector.ts` vs `ai-rules/scan`) — deferred to Phase 2.
- Bulk CSV import — deferred.
- IGNORADA as user-selectable role — internal system state, not a dropdown option.

## Capabilities

### New Capabilities
- `entity-classification`: Manual entity creation, role validation, shared role registry. Covers POST route, Zod schema, and UI dialog for creating EntityContext records.

### Modified Capabilities
- `rule-matching-engine`: No spec-level changes. Role VALUES are preserved — only the source file changes. Matching behavior is identical.

## Approach

1. Fix `entity-roles.json` first — instant OTRO fix for existing dropdowns (EntityOnboardingModal, ContextClarificationModal).
2. Extract shared constant from `role-account-map.ts` + `entity-roles.json` + EntityManagementPage ROLES. Keep VALUES identical, only change SOURCE.
3. Add Zod `.enum()` validation to entity-context schema — roles must match the shared constant.
4. Add "Add Entity" dialog with: pattern input, role dropdown (from shared constant), GL account autocomplete (from Prisma GlAccount).
5. Add POST `/api/learning/entities` — validate with Zod → Prisma create → return EntityContext.
6. Write unit tests: `classifyEntity()` edge cases, manual create validation, role enum boundary cases.
7. Add i18n keys under `entityManagement.create.*`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `rules/entity-roles.json` | Modified | Add missing roles (OTRO, TARJETA_CREDITO, etc.) |
| `src/lib/constants/role-account-map.ts` | Modified | Consolidate into shared role registry |
| `src/lib/validations/entity-context.ts` | Modified | Zod enum validating against role list |
| `src/components/spa/EntityManagementPage.tsx` | Modified | Add "Add Entity" button + form dialog |
| `src/app/api/learning/entities/route.ts` | New | POST route for manual entity creation |
| `src/lib/services/entity-classifier.ts` | Modified | Support manual create code path |
| `src/i18n/locales/{es,en}.ts` | Modified | New keys for manual creation flow |
| `tests/services/entity-classifier.test.ts` | New | Unit tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Role VALUE changes break existing matching | Low | Keep exact values; only change SOURCE |
| Duplicate patterns on manual create | Medium | Prisma `@@unique([companyId, pattern])` constraint prevents |
| Zod enum rejects legacy DB roles | Low | Validation on new records only; existing data passes through |

## Rollback Plan

Revert `entity-roles.json` to previous 5-role version. Revert `role-account-map.ts` to pre-consolidation state. Delete new route file and revert EntityManagementPage. No DB migration was run — new code is additive only.

## Dependencies

- Prisma GlAccount model already exists (no schema change).
- `EntityOnboardingModal` and `ContextClarificationModal` import `entity-roles.json` directly — fix propagates automatically when role list expands.

## Success Criteria

- [ ] OTRO option visible in EntityOnboardingModal dropdown.
- [ ] "Add Entity" creates EntityContext records via POST endpoint with role + GL account.
- [ ] All 11 roles available in shared constant, validated by Zod schema on create.
- [ ] `entity-classifier.ts` test coverage ≥ 70%.
- [ ] No existing entity classification or rule matching is broken.
