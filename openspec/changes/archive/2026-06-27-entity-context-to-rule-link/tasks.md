# Tasks: Entity Context to Rule Link

## Review Workload Forecast
```
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low
```

## Phase 1 — Schema + Migration

- [x] **1.1** Add `entityContextId String?` (FK to EntityContext, no unique) + `isManuallyEdited Boolean @default(false)` to BankRule model in `prisma/schema.prisma`
- [x] **1.2** Run `npx prisma db push` and verify generated Prisma client (migration history drift prevented migrate dev, used db push instead)

## Phase 2 — Core Implementation

- [x] **2.1** Change `classifyEntity()` return type from `Promise<void>` to `Promise<{ context: EntityContext; warning?: string }>` in `src/lib/services/entity-classifier.ts`
- [x] **2.2** Implement `computeDirectionProfile(companyId, pattern)` — query BankTransaction descriptions using `normalizePattern()` for contains match, return `'debit'`/`'credit'`/`'any'` based on >80% threshold
- [x] **2.3** Implement `autoCreateRule(companyId, context, direction)` — dedup logic: skip if active rule with same entityContextId exists, reactivate+update if inactive, ignore manual rules with `entityContextId=null`
- [x] **2.4** Wrap auto-create step in Prisma `$transaction` to prevent race conditions on concurrent classifications of the same pattern
- [x] **2.5** Set `priority=5`, `name="Auto: {pattern}"`, `isActive=true` on auto-created rules
- [x] **2.6** Return `{ context, warning }` when `glAccountId` is null/missing — warning, not error

## Phase 3 — Side-Effects

- [x] **3.1** PATCH `/api/bank-rules/[id]`: detect any field change besides `isActive` → set `isManuallyEdited=true` before update in `src/app/api/bank-rules/[id]/route.ts`
- [x] **3.2** GET `/api/bank-rules/[id]`: include `entityContextId` in response JSON in `src/app/api/bank-rules/[id]/route.ts`
- [x] **3.2b** GET `/api/bank-rules` (list): include `entityContextId` in response shape in `src/app/api/bank-rules/route.ts`
- [x] **3.3** `removeEntityContext(companyId, id)`: add `UPDATE BankRule SET entityContextId=null WHERE entityContextId=id` before the delete; audit-log affected rule IDs in `src/lib/services/entity-context-crud-service.ts`
- [x] **3.4** `bulkRemoveEntityContexts(companyId, ids)`: nullify FK for all target entityContextIds in one `updateMany` call before `deleteMany`; single audit event in `src/lib/services/entity-context-crud-service.ts`
- [x] **3.5** DELETE `/api/entity-context/[id]`: no signature change — route handler already delegates to `removeEntityContext` in `src/app/api/entity-context/[id]/route.ts`

## Phase 4 — Tests

- [x] **4.1** `tests/services/entity-classifier.test.ts`: add tests for `computeDirectionProfile` — debit dominant, credit dominant, mixed, no transactions
- [x] **4.2** `tests/services/entity-classifier.test.ts`: add tests for `autoCreateRule` dedup — active rule skip, inactive reactivation, manual rule untouched
- [x] **4.3** `tests/services/entity-classifier.test.ts`: add test for GL not found → warning returned, no rule created
- [x] **4.4** `tests/services/entity-classifier.test.ts`: add test for happy-path full flow — classification saves context + creates rule with correct direction & priority=5
- [x] **4.5** `tests/services/entity-context-crud-service.test.ts`: add test for `removeEntityContext` — FK nullified before context delete, audit logged
- [x] **4.6** `tests/services/entity-context-crud-service.test.ts`: add test for `bulkRemoveEntityContexts` — multiple FKs nullified, one audit event
- [x] **4.7** `tests/services/entity-context-crud-service.test.ts`: add test for delete with no linked rules — no side-effects
- [x] **4.8** Add test for PUT bank-rule non-isActive field → `isManuallyEdited=true` in `tests/api/bank-rules/id-route.test.ts`
- [x] **4.9** Add test for PUT only `isActive` toggle → `isManuallyEdited` stays `false` in `tests/api/bank-rules/id-route.test.ts`

## Phase 5 — Integration

- [x] **5.1** Wire `classifyEntity()` call site in `src/app/api/learning/classify-entity/route.ts` — surface `warning` field in the API response
- [x] **5.2** Update `db.bankRule.findMany`/`findFirst` queries that use `include`/`select` to optionally include `entityContextId` and `isManuallyEdited` where needed (no exclusion required — additive columns)
- [x] **5.3** Fix type cast `context as unknown as EntityContext` → `context` in `src/lib/services/entity-classifier.ts`
