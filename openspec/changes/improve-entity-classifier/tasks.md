# Tasks: Improve Entity Classifier

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~665 (additions + deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: T-01–T-06 (foundation + core services) → PR 2: T-07–T-12 (prompt + OTRO) → PR 3: T-13–T-17 (web search + polish) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base |
|------|------|-----------|------|
| 1 | Schema migration + direction filter + core service changes | PR 1 | main |
| 2 | Rich prompt + OTRO persistence + review view | PR 2 | main |
| 3 | Web search fallback + polish | PR 3 | main |

---

## Layer 1: Foundation (direction filter)

- [ ] **T-01** `prisma/schema.prisma` — Add `userDescription String?` to EntityContext model. Run `npx prisma migrate dev --name add_user_description`. *(Deps: none | ~5 + migration)*
- [ ] **T-02** Create `src/lib/services/direction-filter.ts` — Export `roleIsValidForDirection(role, directionProfile)` returning `{ valid, reason? }`. Bypass SOCIO/OTRO/IGNORADA. Apply 80% threshold. *(Deps: none | ~50)*
- [ ] **T-03** Create `tests/services/direction-filter.test.ts` — Cover all 11 roles × pure-credit, pure-debit, mixed (55/45), threshold-edge (79/21). Assert which roles excluded per FR-1 scenarios. *(Deps: T-02 | ~100)*
- [ ] **T-04** `src/app/api/learning/suggest-role/route.ts` — Import and call `roleIsValidForDirection()` before AI fallback. Filter ENTITY_ROLES list passed to prompt. *(Deps: T-02 | ~20)*

## Layer 2: Core service changes

- [ ] **T-05** `src/lib/services/entity-context-service.ts` — Add `userDescription?: string` to `saveContext()` input. Include in upsert's `create` and `update` branches. *(Deps: T-01 | ~15)*
- [ ] **T-06** `src/app/api/learning/classify-entity/route.ts` — Accept `userDescription` from request body. Pass to `classifyEntity()` / `saveContext()` when role is OTRO. *(Deps: T-05 | ~10)*

## Layer 3: Rich AI prompt

- [ ] **T-07** `src/app/api/learning/suggest-role/route.ts` — Enrich prompt: inject `directionProfile` (credit%/debit% with money IN/OUT labels), up to 3 `sampleDescriptions`, total amount range. Include sentence `"This entity has X% debit transactions (money OUT) and Y% credit transactions (money IN)"`. Pass filtered roles list from T-04. *(Deps: T-04, T-05 | ~40)*
- [ ] **T-08** Create `tests/services/suggest-role.test.ts` — Mock `fetch` AI call. Verify prompt contains direction labels, samples, amounts. Test with/without direction context. *(Deps: T-07 | ~80)*

## Layer 4: OTRO persistence + review

- [ ] **T-09** `src/components/learning/EntityOnboardingModal.tsx` — Modify `handleClassifyAll()`: when role is OTRO and description >= 5 chars, POST to classify-entity with `{ role: "OTRO", userDescription }` instead of skipping. *(Deps: T-06 | ~30)*
- [ ] **T-10** `src/lib/services/entity-classifier.ts` — Modify `getEntityCandidates()`: skip entities whose `EntityContext.role === "OTRO"` (they're already classified). Add `&& ctx.role !== "OTRO"` to the existing filter. *(Deps: T-01 | ~5)*
- [ ] **T-11** Create OTRO review view — Add route/component to list `EntityContext` records with `role: "OTRO"` for current company. Show `pattern` and `userDescription`. Allow re-classify to a new canonical role. *(Deps: T-06, T-10 | ~60)*
- [ ] **T-12** Create `tests/services/otro-persistence.test.ts` — Test: save OTRO with description, load OTRO entities, skip already-classified in candidates, reject OTRO without description. *(Deps: T-06, T-09 | ~80)*

## Layer 5: Web search fallback

- [x] **T-13** Create `src/lib/services/web-search-service.ts` — `searchEntity(entityName)` with Google Custom Search API. `AbortController` 5s timeout. Config via `WEB_SEARCH_ENABLED`, `WEB_SEARCH_API_KEY`, `WEB_SEARCH_CX`. Return `{ title, snippet, sourceUrl }` or null. *(Deps: none | ~70)*
- [x] **T-14** `src/app/api/learning/suggest-role/route.ts` — After AI returns, if confidence < 80% and `WEB_SEARCH_ENABLED=true`, call `searchEntity()`. Pass result snippet to AI for re-classification. Cap re-classification confidence at 0.70. *(Deps: T-07, T-13 | ~30)*
- [x] **T-15** Create `tests/services/web-search-service.test.ts` — Mock `fetch`. Test: success path, timeout, disabled via env var, missing API key. *(Deps: T-13 | ~60)*

## Layer 6: Polish

- [x] **T-16** `src/lib/constants/entity-roles.ts` — Review `EXPECTED_DIRECTION` mapping. Tune if needed based on real-world validation (no changes expected now). *(Deps: none | ~5)*
- [x] **T-17** Run full test suite — `bunx vitest run` (or project test command). Fix any regressions from the changes. *(Deps: T-01–T-16 | ~0)*
