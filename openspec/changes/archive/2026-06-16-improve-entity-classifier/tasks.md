# Tasks: Improve Entity Classifier

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~450 (9 files) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation) → PR 2 (API+Tests) → PR 3 (UI) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
```

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Shared constants + validation + JSON fix | PR 1 | No UI, no API, no tests — pure refactor |
| 2 | POST endpoint + unit tests | PR 2 | No UI changes; verifiable via test suite |
| 3 | Manual entity creation UI | PR 3 | Depends on PR 1 (constant import), plus i18n |

## Phase 1: Foundation

- [x] 1.1 Create `src/lib/constants/entity-roles.ts` — `ENTITY_ROLES` const (11 roles), `EntityRole` type, `UI_ROLES` (excl. IGNORADA), `entityRoleSchema` Zod helper
- [x] 1.2 Update `rules/entity-roles.json` — add TARJETA_CREDITO, PRESTAMO, GASTO_OPERATIVO, INGRESO, OTRO, IGNORADA
- [x] 1.3 Update `src/lib/constants/role-account-map.ts` — import `EntityRole`, type as `Partial<Record<EntityRole, {...}>>` with compile-time guard for missing roles
- [x] 1.4 Update `src/lib/validations/entity-context.ts` — replace `z.string()` with `z.enum(ENTITY_ROLES)` for role field

## Phase 2: API + Tests

- [x] 2.1 Create `src/app/api/learning/entities/route.ts` — POST handler: Zod validate body, duplicate check (409), `saveContext()` call, 201 response
- [x] 2.2 Create `tests/services/entity-classifier.test.ts` — Vitest tests for `classifyEntity()`, `getEntityCandidates()`, `detectEntityConflict()`, role enum validation (target ≥70% coverage)

## Phase 3: UI

- [x] 3.1 Add i18n keys in `es.ts` and `en.ts` under `entityManagement.create.*` — title, patternLabel, roleLabel, glAccountLabel, submit, success, duplicateError, validationError
- [x] 3.2 Modify `EntityManagementPage.tsx` — import `UI_ROLES`, replace hardcoded `ROLES`, add "Add Entity" button + form dialog with pattern input, role dropdown, and AccountSelector
