# Tasks: Improve Entity Classifier

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~665 (additions + deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: T-01–T-06 → PR 2: T-07–T-12 → PR 3: T-13–T-17 |
| Delivery strategy | ask-on-risk |

### Suggested Work Units

| Unit | Goal | Likely PR | Status |
|------|------|-----------|--------|
| 1 | Schema migration + direction filter + core service changes | PR 1 | ✅ Complete |
| 2 | Rich prompt + OTRO persistence + review view | PR 2 | ⏳ Partial (T-11 pending) |
| 3 | Web search fallback + polish | PR 3 | ✅ Complete |

---

## Layer 1: Foundation (direction filter) ✅

- [x] **T-01** `prisma/schema.prisma` — Add `userDescription String?` to EntityContext model. *(Deps: none | ~5 + migration)*
- [x] **T-02** Create `src/lib/services/direction-filter.ts` — Export `roleIsValidForDirection()`. Bypass SOCIO/OTRO/IGNORADA. Apply 80% threshold. *(Deps: none | ~50)*
- [x] **T-03** Create `tests/services/direction-filter.test.ts` — Cover all 11 roles × profiles. *(Deps: T-02 | ~100)*
- [x] **T-04** `src/app/api/learning/suggest-role/route.ts` — Import and call `roleIsValidForDirection()`. Filter ENTITY_ROLES list. *(Deps: T-02 | ~20)*

## Layer 2: Core service changes ✅

- [x] **T-05** `src/lib/services/entity-context-service.ts` — Add `userDescription?: string` to `saveContext()`. *(Deps: T-01 | ~15)*
- [x] **T-06** `src/app/api/learning/classify-entity/route.ts` — Accept `userDescription` from body. Pass to `classifyEntity()`. *(Deps: T-05 | ~10)*

## Layer 3: Rich AI prompt ✅

- [x] **T-07** `src/app/api/learning/suggest-role/route.ts` — Enrich prompt: directionProfile, samples, amounts. *(Deps: T-04, T-05 | ~40)*
- [x] **T-08** Create `tests/services/suggest-role.test.ts` — Mock AI call. Verify prompt contents. *(Deps: T-07 | ~80)*

## Layer 4: OTRO persistence + review ⏳

- [x] **T-09** `EntityOnboardingModal.tsx` — POST OTRO with `userDescription` en `handleClassifyAll()`. *(Deps: T-06 | ~30)*
- [x] **T-10** `src/lib/services/entity-classifier.ts` — `getEntityCandidates()` saltea OTROs existentes. *(Deps: T-01 | ~5)*
- [x] **T-11** Mostrar `userDescription` en columna de EntityManagementPage — la vista ya existía. *(Deps: T-06, T-10 | ~15)*
- [x] **T-12** Create `tests/services/otro-persistence.test.ts` — Save/load/skip/reject OTRO. *(Deps: T-06, T-09 | ~80)*

## Layer 5: Web search fallback ✅

- [x] **T-13** Create `src/lib/services/web-search-service.ts`. *(Deps: none | ~70)*
- [x] **T-14** Web search fallback en suggest-role route. *(Deps: T-07, T-13 | ~30)*
- [x] **T-15** Create `tests/services/web-search-service.test.ts`. *(Deps: T-13 | ~60)*

## Layer 6: Polish ✅

- [x] **T-16** Review `EXPECTED_DIRECTION` mapping en entity-roles.ts. *(Deps: none | ~5)*
- [x] **T-17** Run full test suite. *(Deps: T-01–T-16 | ~0)*
