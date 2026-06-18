# Delta: Entity Classification

## Modified: Role Validation

`entityContextSchema` changes from `role: z.string().min(1).max(50)` to `entityRoleSchema` (z.enum(ENTITY_ROLES)). ALL paths validate, including PATCH.

| Path | Change |
|------|--------|
| POST /api/learning/context | Auto-fixed via entityContextSchema |
| PATCH /api/entity-context/[id] | Add Zod validation with entityRoleSchema |
| POST /api/learning/classify-entity | Add role validation before classifyEntity() |
| POST /api/learning/entities | Already validates — no change |

#### Scenario: PATCH rejects invalid role

- GIVEN an existing EntityContext
- WHEN PATCHing with `{ role: "INVALID" }`
- THEN return 400 with validation error

## New: OTRO → AI Suggestion → Canonical Role

When user selects OTRO: free-text input appears ("Describí qué es esta entidad..."). ~1s debounce after typing stops (min 5 chars) → `POST /api/learning/suggest-role`. AI returns `{ suggestedRole, confidence, explanation }`.

| Scenario | Behavior |
|----------|----------|
| confidence >= 0.7 | Toast: "💡 Esto parece {role} ({account}). {explanation}. [ASIGNAR]" → sets canonical role + opens pre-filtered GL selector |
| confidence < 0.7 | Toast: "No pude determinar un rol. ¿Podés describirlo con más detalle?" |
| 2 consecutive failures | Toast: "Todavía no puedo determinarlo. Elegí un rol manualmente del dropdown." |
| OTRO selected, no role assigned | Save blocked — entity NEVER persists "OTRO" as role |
| AI network error | Toast: "No disponible ahora. Elegí manualmente." |
| User rejects suggestion | User picks from dropdown manually |

Existing OTRO entries: free-text role coalesced to "OTRO" on read; DB migration maps old values.

## New: Direction Mismatch Warning

Role assignment MUST call `checkRoleDirectionMismatch()`. On conflict, show non-blocking yellow banner. User may override.

## New: Split Mixed Entities

When `creditPct >= 0.15 && debitPct >= 0.15` in EntityOnboardingModal, show split option. User selects one direction → creates EntityContext with `transactionDirection`. Other side stays unclassified. Next scan detects existing pattern+direction and prompts: "Create separate entity for remaining {other_direction} transactions?"
