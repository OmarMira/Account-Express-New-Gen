# Tasks: Smart Entity Classification

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500–600 |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Suggested split | PR 1: Foundation + Routes → PR 2: Core Services → PR 3: Frontend → PR 4: Migration |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: **Yes**
Chained PRs recommended: **Yes**
Chain strategy: pending
400-line budget risk: **High**

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation + Routes (schema, types, role validation) | PR 1 | Base branch: main. Includes route tests. |
| 2 | Core Services (enricher, suggest-role, CRUD) | PR 2 | Depends on PR 1. Services + unit tests. |
| 3 | Frontend (EntityOnboardingModal: warning + split + toast) | PR 3 | Depends on PR 1 & 2. Client + component tests. |
| 4 | Migration (existing free-text roles) | PR 4 | Depends on PR 3. Optional — could merge into PR 1. |

## Phase 1: Foundation

- [x] 1.1 — `prisma/schema.prisma`: add nullable `transactionDirection String?` to EntityContext model
- [x] 1.2 — `src/lib/types/entity-context.ts`: add `transactionDirection` to `UpdateEntityInput` and `EntityContextWithGlAccount`
- [x] 1.3 — `src/lib/constants/entity-roles.ts`: export `entityRoleSchema`; add `EXPECTED_DIRECTION` lookup record
- [x] 1.4 — `src/lib/constants/role-account-map.ts`: add `expectedDirection` field to each mapping; export `RoleDirectionMap` type
- [x] 1.5 — `src/lib/validations/entity-context.ts`: change `role: z.string()` → `entityRoleSchema`

## Phase 2: Core Services

- [x] 2.1 — `src/lib/services/entity-enricher.ts`: add `checkRoleDirectionMismatch()` pure function; wire into enrichment pipeline
- [x] 2.2 — `src/lib/services/entity-context-crud-service.ts`: support `transactionDirection` in create/update
- [x] 2.3 — **Create** `src/app/api/learning/suggest-role/route.ts`: POST handler, validate input, call `parseWithAI()`, map response to canonical role

## Phase 3: Routes

- [x] 3.1 — `src/app/api/entity-context/[id]/route.ts`: add `entityRoleSchema` Zod parse to PATCH body
- [x] 3.2 — `src/app/api/learning/classify-entity/route.ts`: validate `role` with `entityRoleSchema` before `classifyEntity()`
- [x] 3.3 — `src/app/api/learning/context/route.ts`: auto-fixed via `entityContextSchema` import — verify no manual change needed

## Phase 4: Frontend

- [x] 4.1 — `src/components/learning/EntityOnboardingModal.tsx`: **F2** — show yellow banner when `checkRoleDirectionMismatch()` returns warning; override button logs mismatch server-side
- [x] 4.2 — `src/components/learning/EntityOnboardingModal.tsx`: **F3** — detect mixed (creditPct ≥ 0.15 && debitPct ≥ 0.15); show split UI; create EntityContext with `transactionDirection`
- [x] 4.3 — `src/components/learning/EntityOnboardingModal.tsx`: **F4** — OTRO debounce (1s, min 5 chars) → POST suggest-role; confidence ≥ 0.7 shows toast with [ASIGNAR]; < 0.7 asks for more detail; 2 failures hides suggestions
- [x] 4.4 — `src/components/learning/EntityOnboardingModal.tsx`: block save if OTRO selected without assigned canonical role

## Phase 5: Testing

- [x] 5.1 — Unit: 6 scenarios for `checkRoleDirectionMismatch()` (CLIENTE+credit=ok, CLIENTE+debit=warn, SOCIO any=ok, INGRESO+debit=warn, PROVEEDOR+credit=warn, OTRO/IGNORADA=ok)
- [x] 5.2 — Unit: `suggest-role` response mapping (AI output → canonical role; confidence threshold parsing; string confidence coercion)
- [x] 5.3 — Integration: 4 PATCH paths with invalid role → 400 (POST context, POST classify-entity, PATCH [id], POST entities)
- [x] 5.4 — Integration: POST /api/learning/suggest-role (valid → 200 with canonical role; empty → 400; AI failure → 502; non-canonical → 502)
- [x] 5.5 — Component: EntityOnboardingModal split flow (mixed candidate shows split UI; split buttons work; directional entities hide split)
- [x] 5.6 — Component: EntityOnboardingModal OTRO AI suggestion (OTRO → textarea → debounce → API → toast with ASIGNAR / low confidence / error)

## Phase 6: Migration

- [x] 6.1 — One-time DB migration: map `role NOT IN ENTITY_ROLES` to `"OTRO"`; optionally store original in metadata
