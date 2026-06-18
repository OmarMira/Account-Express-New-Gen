# Design: Smart Entity Classification

## Technical Approach

Four independent-but-complementary features on a shared entity data integrity axis. F1 is a schema change cascading through 4 routes. F2 adds a role↔direction check in the enrichment layer. F3 extends the onboarding modal to split mixed-direction entities. F4 adds a lightweight AI endpoint + debounced toast in the OTRO flow.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| F1 schema strategy | Inline enum in each route / shared `entityRoleSchema` | Shared `entityRoleSchema` | Already exists in `entity-roles.ts`; consistency + single source of truth |
| F1 PATCH validation | Server middleware / per-route | Per-route Zod parse | Follows existing pattern (`api/learning/entities`); explicit > magic |
| F2 warning location | Backend-only / UI-only / shared check | Shared `checkRoleDirectionMismatch()` + UI | Business logic testable without DOM; UI renders the banner |
| F3 uniqueness | Compound unique on `[companyId, pattern, transactionDirection]` / suffix pattern | Suffix pattern (`"omar mira - ingresos"`) | Avoids Prisma migration on unique constraint; backward-compatible with existing records |
| F3 storage | Separate `EntitySplit` table / field on `EntityContext` | `transactionDirection` field on `EntityContext` | Simpler queries; reuses existing CRUD; no new table |
| F4 AI endpoint | Standalone route / extend classify-entity | Standalone route | Cleaner isolation; no side effects; simpler prompt |
| F4 debounce | Lodash / hand-rolled `setTimeout` | Hand-rolled `useEffect` + `setTimeout` | Zero dependency; trivial pattern (1s debounce, min 5 chars) |

## Data Flow

```
F1 Role Validation
  Request → Zod parse(entityRoleSchema) → 400 | DB write

F2 Mismatch Warning
  [UI] role dropdown change → checkRoleDirectionMismatch(role, creditPct, debitPct)
    → null → no banner
    → warning → yellow banner + override button → audit log on confirm

F3 Entity Split
  [scan] creditPct >= 0.15 && debitPct >= 0.15 → "Split into 2?" shown
  [split] user picks direction → POST { pattern: "{base} - ingresos", role, transactionDirection: "credit" }
  [re-scan] direction profile exists but opposite remains unclassified → prompt for second split

F4 AI Role Suggestion
  OTRO selected + typing → 1s debounce → POST /api/learning/suggest-role
    → parseWithAI(modified prompt) → { suggestedRole, confidence, explanation }
    → confidence >= 0.7 → Toast with [ASIGNAR] button
    → confidence < 0.7 → Toast asking for more detail
    → 2 failures → Toast "Elegí manualmente", hide suggestions
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/validations/entity-context.ts` | Modify | Change `role: z.string()` → `entityRoleSchema` |
| `src/lib/constants/role-account-map.ts` | Modify | Add `expectedDirection: 'credit' \| 'debit' \| 'mixed' \| null` to mappings; export `RoleDirectionMap` type |
| `src/lib/constants/entity-roles.ts` | Modify | Export `entityRoleSchema` (already exists); add `EXPECTED_DIRECTION` lookup record |
| `src/lib/services/entity-enricher.ts` | Modify | Add `checkRoleDirectionMismatch()`; call in enrichment pipeline |
| `src/app/api/entity-context/[id]/route.ts` | Modify | Add `entityRoleSchema` Zod parse to PATCH body |
| `src/app/api/learning/context/route.ts` | Modify | Auto-fixed via `entityContextSchema` import — no direct change needed |
| `src/app/api/learning/classify-entity/route.ts` | Modify | Validate `role` with `entityRoleSchema` before `classifyEntity()` |
| `src/app/api/learning/suggest-role/route.ts` | **Create** | POST handler; validates input, calls `parseWithAI()`, maps response to canonical role |
| `src/components/learning/EntityOnboardingModal.tsx` | Modify | F2: show mismatch warning; F3: detect mixed → split UI; F4: OTRO debounce + toast |
| `prisma/schema.prisma` | Modify | Add nullable `transactionDirection String?` to EntityContext model |
| `src/lib/services/entity-context-crud-service.ts` | Modify | Support `transactionDirection` in updates |
| `src/lib/types/entity-context.ts` | Modify | Add `transactionDirection` to `UpdateEntityInput` and `EntityContextWithGlAccount` |

## Interfaces / Contracts

```ts
// role-account-map.ts — new field
type ExpectedDirection = 'credit' | 'debit' | 'mixed' | null;
type AccountMapping = {
  debit: string;
  credit: string;
  fallback: string;
  expectedDirection: ExpectedDirection; // NEW
};

// entity-enricher.ts — new function
function checkRoleDirectionMismatch(
  role: EntityRole,
  debitPct: number,
  creditPct: number,
): { warning: string } | null;
// Returns warning only when expectedDirection conflicts with actual direction profile.
// SOCIO (mixed) and OTRO/IGNORADA (null) never warn.

// suggest-role/route.ts — new endpoint contract
// POST /api/learning/suggest-role
// Input: { description: string, locale?: string }
// Output: { suggestedRole: string, confidence: number, explanation: string }
// suggestedRole is always a canonical ENTITY_ROLES value, never free text.
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `checkRoleDirectionMismatch()` | 6 scenarios: CLIENTE+credit=no warning, CLIENTE+debit=warning, SOCIO any direction=no warning, INGRESO+debit=warning, PROVEEDOR+credit=warning, OTRO/IGNORADA always no warning |
| Unit | `suggest-role` response mapping | AI output → canonical role mapping; confidence threshold parsing |
| Integration | 4 PATCH paths with invalid role | Each returns 400; error format matches existing Zod errors |
| Integration | `POST /api/learning/suggest-role` | Valid input → 200 with suggestedRole in ENTITY_ROLES; empty input → 400 |
| E2E | EntityOnboardingModal split flow | Open modal with mixed candidate → see split button → select direction → verify EntityContext created with transactionDirection |
| E2E | OTRO AI suggestion toast | Select OTRO → type 5+ chars → wait 1.2s → toast appears → click [ASIGNAR] → role set to suggested |

## Migration / Rollout

1. **Existing free-text roles**: `entityRoleSchema` on read-side already handles nullish coalescing to `OTRO` via the `entities/route.ts` → `classifyEntity()` path. A one-time DB migration maps any `role NOT IN ENTITY_ROLES` to `"OTRO"` and stores the original in a new `originalRole` metadata field (optional first pass: just coalesce on read).
2. **Unique constraint**: No change needed — existing `@@unique([companyId, pattern])` is preserved. Split entities use suffixed patterns.
3. **Backward compat**: PATCH route change is additive (more strict validation). Existing integrations that send invalid roles will 400 after deploy.

## Open Questions

- [ ] Should `transactionDirection` prevent rule matching against opposite-direction transactions? Current design says no — direction metadata is advisory only.
- [ ] AI suggestion prompt: should we reuse the existing `systemInstruction` from `assistant-config.json` or write a hardcoded minimal prompt for role classification? Hardcoded minimal is safer for consistency.
- [ ] Confidence threshold: is 0.7 correct for first-slice deployment, or should we start with 0.8 and tune down after telemetry?
