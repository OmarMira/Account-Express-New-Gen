# Design: Improve Entity Classifier

## Technical Approach

Phase 1 of a two-phase plan (Option C from exploration). Extract a shared role constant, add Zod enum validation, add manual entity creation (UI + API), and add unit test coverage — while leaving the dual detection engine architecture unchanged.

```
┌──────────────────────────────┐
│ src/lib/constants/           │
│  entity-roles.ts ◄── SOURCE │ ← New shared constant (11 roles)
├──────────────────────────────┤
│ ▲                    ▲       │
│ │                    │       │
├───────────┐  ┌───────┴───────┤
│ role-     │  │ entity-       │
│ account-  │  │ context.ts    │
│ map.ts    │  │ (Zod enum)    │
└───────────┘  └───────────────┘
│                              │
├─── EntityManagementPage.tsx  │ ← imports ENTITY_ROLES, adds "Add Entity" dialog
├─── POST /api/learning/       │
│    entities/route.ts         │ ← new endpoint, validates via Zod
├─── tests/services/           │
│    entity-classifier.test.ts │ ← new unit tests
└──────────────────────────────┘
```

## Architecture Decisions

### Decision: Shared constant location

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `rules/entity-roles.json` only | Non-TS consumers work; no type safety | ❌ |
| `src/lib/constants/entity-roles.ts` + update JSON | Type-safe + backward compat for JSON importers | ✅ |
| TS-only, deprecate JSON | Breaks existing imports in 2 modals; more refactoring | ❌ Phase 2 |

**Rationale**: Create `ENTITY_ROLES` as a typed `const` array + `EntityRole` type in a new file. Also update `entity-roles.json` with all 11 roles so existing JSON consumers (EntityOnboardingModal, ContextClarificationModal) get the fix immediately without refactoring.

### Decision: ROLE_ACCOUNT_MAP integration

**Choice**: Keep `ROLE_ACCOUNT_MAP` with its current 9 entries (OTRO and IGNORADA have no account mapping). Type as `Partial<Record<EntityRole, {...}>>` importing the shared constant. Add a compile-time guard that warns if any non-OTRO/IGNORADA role is missing.

**Rationale**: OTRO and IGNORADA are system roles — no GL account mapping makes sense. Partial record preserves type safety without forcing fake entries.

### Decision: GL account selector

**Choice**: Reuse existing `AccountSelector` from `src/components/spa/journal/AccountSelector.tsx` (used by ContextClarificationModal). Fetch accounts via `/api/journal/accounts?companyId=X` on dialog open.

**Rationale**: Same pattern already proven in `ContextClarificationModal.tsx`. No new component needed. Pre-select the fallback account from `ROLE_ACCOUNT_MAP`.

### Decision: Form pattern

**Choice**: Modal dialog (consistent with `EntityOnboardingModal`). Reuses existing `Dialog` primitives used throughout the SPA. Avoids inline form that would compete with the table layout.

### Decision: POST route location

**Choice**: `/api/learning/entities` (new file), not `/api/entity-context` (which has different semantics — bulk delete POST).

**Rationale**: Clear separation — `/api/entity-context` handles GET/PATCH/DELETE for existing records; `/api/learning/entities` handles manual create with its own validation.

## Data Flow

```
User clicks "Add Entity" → Dialog opens (fetches GL accounts)
  → User fills pattern + role + selects GL account
  → POST /api/learning/entities
    → Zod validation (role enum, pattern required)
    → Prisma findFirst (check duplicate pattern+companyId)
    → 409 if duplicate
    → entity-context-service.saveContext() (create)
    → 201 + created record
  → UI refreshes list, toast success
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/constants/entity-roles.ts` | Create | Shared `ENTITY_ROLES` (11 roles) + `EntityRole` type + `ENTITY_ROLES_ENUM` Zod helper |
| `rules/entity-roles.json` | Modify | Add TARJETA_CREDITO, PRESTAMO, GASTO_OPERATIVO, INGRESO, OTRO, IGNORADA |
| `src/lib/constants/role-account-map.ts` | Modify | Import `EntityRole` type; type as `Partial<Record<EntityRole, ...>>` |
| `src/lib/validations/entity-context.ts` | Modify | Replace `z.string()` with `z.enum(ENTITY_ROLES)` |
| `src/components/spa/EntityManagementPage.tsx` | Modify | Import `ENTITY_ROLES`; replace hardcoded `ROLES`; add "Add Entity" button + form dialog with `AccountSelector` |
| `src/app/api/learning/entities/route.ts` | Create | POST handler: Zod validate → duplicate check (409) → `saveContext()` → 201 |
| `src/i18n/locales/es.ts` | Modify | Add `entityManagement.create.*` keys |
| `src/i18n/locales/en.ts` | Modify | Add `entityManagement.create.*` keys |
| `tests/services/entity-classifier.test.ts` | Create | Unit tests for `classifyEntity` and `getEntityCandidates` |

## Interfaces

```typescript
// src/lib/constants/entity-roles.ts
export const ENTITY_ROLES = [
  'INQUILINO', 'PROVEEDOR', 'SOCIO', 'CLIENTE', 'EMPLEADO',
  'TARJETA_CREDITO', 'PRESTAMO', 'GASTO_OPERATIVO', 'INGRESO',
  'OTRO', 'IGNORADA',
] as const;

export type EntityRole = (typeof ENTITY_ROLES)[number];

export const UI_ROLES = ENTITY_ROLES.filter((r) => r !== 'IGNORADA');

// Zod helper
export const entityRoleSchema = z.enum(ENTITY_ROLES);
```

```typescript
// POST /api/learning/entities — request body
interface CreateEntityRequest {
  pattern: string;       // min 1, max 255
  role: EntityRole;     // validated via z.enum
  glAccountId?: string; // optional, validated via Zod nullable().optional()
}
// Response 201: { success: true, data: EntityContext }
// Response 409: { error: 'Entity with this pattern already exists' }
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `classifyEntity()` — edge cases (null glAccountCode, empty pattern, missing userId) | Vitest, mock db calls directly |
| Unit | `getEntityCandidates()` — known entity filtering, rule exclusion | Vitest with factory helpers |
| Unit | `detectEntityConflict()` — merchant detection, SOCIO in INDN | Pure function, no DB needed |
| Unit | Role enum validation — valid + invalid role rejection | Pure Zod parse test |

Test file at `tests/services/entity-classifier.test.ts`. No integration tests for Phase 1 — existing `entity-first-flow.test.ts` already covers integration paths.

## Migration / Rollout

No migration required. All changes are additive: new constant, new route, new UI button, expanded JSON. Existing records are never re-validated against the new Zod enum. Rollback: revert 9 files listed above.

## Open Questions

- None. All decisions are resolved.
