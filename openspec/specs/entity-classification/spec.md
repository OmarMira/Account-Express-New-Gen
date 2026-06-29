# Entity Classification Specification

## Purpose

Define the shared role registry, role validation, manual entity creation flow (UI + API), and test coverage requirements for the entity classification domain.

## Requirements

### Requirement: Shared Role Registry

The system MUST expose a single exported constant `ENTITY_ROLES` containing exactly 11 roles: INQUILINO, PROVEEDOR, SOCIO, CLIENTE, EMPLEADO, TARJETA_CREDITO, PRESTAMO, GASTO_OPERATIVO, INGRESO, OTRO, IGNORADA. This constant MUST consolidate the role lists from `rules/entity-roles.json`, `EntityManagementPage.tsx`, and `ROLE_ACCOUNT_MAP` keys.

IGNORADA MUST NOT appear in any user-facing dropdown. `ROLE_ACCOUNT_MAP` MUST derive its keys from `ENTITY_ROLES` by importing the constant. All consumers MUST import from the shared constant and MUST NOT define their own role lists.

#### Scenario: Roles match across all sources

- GIVEN the shared `ENTITY_ROLES` constant
- WHEN compared against `entity-roles.json`, `EntityManagementPage` roles, and `ROLE_ACCOUNT_MAP` keys
- THEN all sources MUST contain the same 11 role values

#### Scenario: Adding a role propagates to all consumers

- GIVEN a new role added to `ENTITY_ROLES`
- WHEN the system is rebuilt
- THEN `entity-roles.json`, `role-account-map.ts`, and EntityManagementPage dropdown MUST reflect the new role without additional changes

### Requirement: Role Validation

The Zod schema `entityContextSchema` in `entity-context.ts` MUST validate the `role` field against `ENTITY_ROLES` using `entityRoleSchema` (`z.enum(ENTITY_ROLES)`). Validation MUST reject any value not present in the shared constant. This validation MUST apply to ALL creation and update paths:
- POST `/api/learning/context` — auto-fixed via entityContextSchema import
- PATCH `/api/entity-context/[id]` — explicit Zod validation with entityRoleSchema
- POST `/api/learning/classify-entity` — validates role before classifyEntity()
- POST `/api/learning/entities` — already validates via entityRoleSchema

Existing database records with non-canonical roles MUST coalesce to `"OTRO"` on read via nullish coalescing. A one-time migration script maps any `role NOT IN ENTITY_ROLES` to `"OTRO"`.

#### Scenario: Valid role passes validation

- GIVEN a valid role from `ENTITY_ROLES`
- WHEN creating an EntityContext record via any creation path
- THEN validation MUST pass

#### Scenario: Invalid role is rejected

- GIVEN a role value not present in `ENTITY_ROLES`
- WHEN creating or updating an EntityContext record via any of the 4 paths
- THEN validation MUST fail with a 400 error indicating the role is invalid

#### Scenario: PATCH rejects invalid role

- GIVEN an existing EntityContext
- WHEN PATCHing with `{ role: "INVALID" }`
- THEN return 400 with validation error

### Requirement: Manual Entity Creation (UI)

EntityManagementPage MUST display an "Add Entity" button. Clicking it MUST open a form dialog with: a text input for pattern/name, a role dropdown listing exactly 10 roles (all except IGNORADA), and a GL account selector. Submitting MUST POST to `/api/learning/entities`. All labels, placeholders, and errors MUST use `t()` under the `entityManagement.create.*` key namespace.

#### Scenario: Create entity successfully

- GIVEN the user fills in pattern "ACME CORP", selects role "PROVEEDOR", and picks a GL account
- WHEN clicking submit
- THEN the form POSTs to `/api/learning/entities` and displays a success notification

#### Scenario: Duplicate pattern shows error

- GIVEN the user fills in a pattern that already exists for the company
- WHEN submitting the form
- THEN the UI displays an error message indicating the pattern already exists

#### Scenario: Missing required fields blocked

- GIVEN the user clicks submit without filling pattern or selecting a role
- WHEN the form validates
- THEN submit MUST be blocked and inline errors indicate which fields are required

### Requirement: Actor Type and Transaction Intent in Entity Onboarding

EntityOnboardingModal MUST show the entity's Actor Type (from entity-roles / EXPECTED_DIRECTION) as a read-only contextual label, and MUST include a TransactionIntent dropdown with bilingual labels (EN/ES) for optional intent selection.

#### Scenario: Actor Type shown as read-only label

- GIVEN an entity candidate with role `INQUILINO` (via dropdown selection)
- WHEN the EntityOnboardingModal renders
- THEN the entity card shows a read-only label/badge displaying `INQUILINO` (the Actor Type)
- AND the label is visually distinct from editable controls (e.g., muted background, no border, no hover effect)
- AND the label updates automatically when the user changes the role selection
- AND when no role is yet selected, no Actor Type label is shown

#### Scenario: Direction hint below badge

- GIVEN an entity candidate with role `INQUILINO`
- WHEN the Actor Type badge renders
- THEN a direction hint is shown below the badge (e.g., "Expected: Income" or "Expected: Expense") derived from `EXPECTED_DIRECTION`
- AND when a role has mixed direction or no expected direction, no hint is shown
- AND no hint is shown for OTRO or IGNORADA roles

#### Scenario: Intent dropdown present and bilingual

- GIVEN the EntityOnboardingModal is open with at least one entity candidate
- WHEN the user scrolls to an entity card
- THEN there is a `<Select>` or equivalent dropdown labeled with the i18n key `learning.intentLabel`
- AND the dropdown contains one option per TransactionIntent value
- AND each option displays the bilingual label according to the current locale (e.g., "Rent Payment" in EN, "Pago de Renta" in ES)
- AND the first option is an empty/unset placeholder (e.g., `learning.intentPlaceholder`)
- AND the Select component uses the same pattern as the existing role `<Select>` (shadcn/ui Select)

#### Scenario: Intent selection is optional

- GIVEN the intent dropdown
- WHEN the user does not select any intent value (remains unset/placeholder)
- THEN the entity can still be classified and saved without intent
- AND the auto-created rule (via autoCreateRule) has `intent = null`
- AND the UI does not block or warn about the missing intent

#### Scenario: Intent propagated to autoCreateRule

- GIVEN the user selects an intent (e.g., `RENT_PAYMENT`) in the dropdown
- WHEN they proceed to classify the entity (via Pre-classify or Classify All)
- THEN the `classify-entity` API call includes the selected intent
- AND `autoCreateRule()` creates the BankRule with `intent = "RENT_PAYMENT"`
- AND the saved entity reflects the intent selection in subsequent views

### Requirement: Manual Entity Creation (API)

POST `/api/learning/entities` MUST accept `{ pattern: string, role: string, glAccountId?: string }`. The endpoint MUST validate `role` against `ENTITY_ROLES` via the Zod schema. If a record with the same `pattern` and `companyId` already exists, the endpoint MUST return HTTP 409. On success, it MUST create an EntityContext record and return it as JSON with status 201.

#### Scenario: Creates entity in DB

- GIVEN a valid request `{ pattern: "ACME CORP", role: "PROVEEDOR", glAccountId: "gl_001" }`
- WHEN POSTing to `/api/learning/entities`
- THEN an EntityContext record is created with the provided values
- AND the response status is 201 with the created record body

#### Scenario: 409 on duplicate

- GIVEN an existing EntityContext with pattern "ACME CORP" for company "comp_1"
- WHEN POSTing `{ pattern: "ACME CORP", role: "PROVEEDOR" }` for the same company
- THEN the endpoint returns HTTP 409 with an error message

### Requirement: Entity Classifier Tests

`entity-classifier.ts` and `entity-detector.ts` MUST have unit tests covering `getEntityCandidates`, `clusterCandidates` (all modes: fuzzy, exact, hybrid), and the core classification logic. Tests MUST use Vitest with no external HTTP dependencies. Target coverage MUST be at least 70% for each module.

#### Scenario: Known entity is found

- GIVEN EntityContext records exist with patterns matching transaction descriptions
- WHEN `getEntityCandidates` is called with transaction data for that company
- THEN the known entity MUST appear in the returned candidates

#### Scenario: Unknown pattern returns empty

- GIVEN no EntityContext records match any transaction descriptions
- WHEN `getEntityCandidates` is called
- THEN the returned candidates list MUST be empty

#### Scenario: Exact mode matches normalized keys

- GIVEN transactions "MERCADO A" and "mercado a"
- WHEN `clusterCandidates` is called with `{ mode: 'exact' }`
- THEN both are in the same cluster with count 2

#### Scenario: Mode produces different clusters on same data

- GIVEN a set of transactions with similar but not identical descriptions
- WHEN clustered with fuzzy mode AND with exact mode separately
- THEN the cluster count MAY differ between modes

### Requirement: Unified Clustering with Configurable Mode

`clusterCandidates()` MUST accept an optional second argument `ClusterOptions` with a `mode` field accepting `"fuzzy"`, `"exact"`, or `"hybrid"`. Default MUST be `"fuzzy"`. Additional options: `requireRole` filters by role, `smartFrequency` adjusts min-occurrence thresholds dynamically, `extraNumberStrip` strips trailing numeric suffixes before matching.

- **fuzzy**: group by Jaro-Winkler similarity >= 0.85 on raw description (existing behavior).
- **exact**: group by normalized key equality (lowercase, strip punctuation, collapse whitespace).
- **hybrid**: attempt exact first; if no exact group meets min-occurrence, fall back to fuzzy.

#### Scenario: Fuzzy groups similar descriptions

- GIVEN transactions with descriptions "ACME CORP SA", "ACME CORP", "ACME CORP SRL"
- WHEN `clusterCandidates` is called with `{ mode: 'fuzzy' }`
- THEN all three descriptions are grouped into a single cluster

#### Scenario: Exact requires normalized equality

- GIVEN transactions "ACME CORP.", "acme corp", "ACME CORP SA"
- WHEN `clusterCandidates` is called with `{ mode: 'exact' }`
- THEN "ACME CORP." and "acme corp" are grouped; "ACME CORP SA" is a separate group

#### Scenario: Hybrid falls back to fuzzy when exact fails

- GIVEN transactions where no exact group meets min-occurrence threshold
- WHEN `clusterCandidates` is called with `{ mode: 'hybrid' }`
- THEN exact is attempted first, then fuzzy similarity is applied to remaining candidates

#### Scenario: Default mode preserves existing behavior

- GIVEN no `ClusterOptions` argument
- WHEN `clusterCandidates(config)` is called
- THEN clustering uses fuzzy mode (identical to pre-change behavior)

#### Scenario: requireRole filters output

- GIVEN candidates with roles PROVEEDOR and CLIENTE
- WHEN `clusterCandidates` is called with `{ requireRole: 'PROVEEDOR' }`
- THEN output contains only PROVEEDOR candidates

### Requirement: Backward Compatible Output Shape

Existing callers MUST receive the same return type regardless of mode. The `ClusterResult` shape (fields, types, nesting) SHALL NOT change.

#### Scenario: Caller unaffected by mode switch

- GIVEN code destructuring `{ entity, count, similarity }` from cluster results
- WHEN the same code calls `clusterCandidates` with `mode: 'exact'` instead of default
- THEN the destructured fields have identical keys and types

### Requirement: OTRO AI Role Suggestion

When the user selects OTRO in EntityOnboardingModal, a free-text input appears ("Describí qué es esta entidad..."). After a ~1s debounce from typing stop (min 5 chars), the system MUST call `POST /api/learning/suggest-role` which returns `{ suggestedRole, confidence, explanation }` via `parseWithAI()`.

- confidence >= 0.7 → Toast with "[ASIGNAR]" button; clicking sets canonical role
- confidence < 0.7 → Toast asking for more detail
- 2 consecutive failures → Hide suggestions for this session
- AI network error → Toast "No disponible ahora. Elegí manualmente."
- OTRO without assigned canonical role → Save blocked (entity NEVER persists "OTRO" as role)

#### Scenario: Valid suggestion returned

- GIVEN `{ description: "cobra alquileres mensuales" }`
- WHEN POST /api/learning/suggest-role
- THEN response `{ suggestedRole: "INQUILINO", confidence: 0.92, explanation: "Cobro recurrente de alquiler" }`

#### Scenario: Server-side confidence capping at 0.69

- GIVEN the `/api/learning/suggest-role` endpoint
- WHEN the LLM returns a suggestion with confidence ≥ 0.7 (e.g., 0.92)
- THEN the response `confidence` field is capped to `0.69`
- AND the HTTP response body contains `"confidence": 0.69`
- AND the original confidence value from the LLM is discarded (not exposed to the client)
- AND when the LLM returns confidence < 0.7 (e.g., 0.45), the value is preserved as-is

#### Scenario: Apply All excludes LOW confidence

- GIVEN the Apply All endpoint for the suggestion/learning flow (not the deterministic rule matcher)
- WHEN processing candidate suggestions
- THEN any item with `confidence < 0.7` is skipped
- AND the response summary reports the count of skipped items
- AND no BankRule is created or modified for skipped items
- AND the deterministic Apply All path (rule-matching-engine) is untouched — it has no confidence field

#### Scenario: Frontend LOW confidence indicator

- GIVEN a batch result banner with `confidence < 0.7`
- WHEN the banner renders
- THEN the confidence text uses muted/warning styling (e.g., `text-yellow-600`)
- AND the label shows "Low confidence: {percent}%" instead of "Confidence: {percent}%"
- AND the Accept button is still available (user can still manually confirm)

#### Scenario: Assign sets canonical role

- GIVEN user types "cobra alquiler" and toast suggests INQUILINO
- WHEN user clicks [ASIGNAR]
- THEN role is set to INQUILINO (NOT OTRO)
- AND GL account selector opens pre-filtered for INQUILINO accounts

### Requirement: Direction Mismatch Warning

On role assignment (create or edit), the system MUST call `roleIsValidForDirection()` (canonical validator from `direction-filter.ts`). On mismatch (`{ valid: false }`), display a non-blocking yellow banner. The user may override via an explicitly labeled button. SOCIO (expectedDirection: mixed) MUST bypass the warning regardless of direction profile. Override events MUST be logged server-side.

#### Scenario: Warning shown for mismatch

- GIVEN user assigns CLIENTE to an entity with 100% debits
- WHEN roleIsValidForDirection returns `{ valid: false, reason: "..." }`
- THEN yellow banner is displayed and user must confirm override

#### Scenario: SOCIO bypasses warning

- GIVEN user assigns SOCIO to entity with any direction profile
- WHEN roleIsValidForDirection returns `{ valid: true }`
- THEN no warning shown

#### Scenario: Warning logged on override

- GIVEN user clicks override button
- WHEN entity is saved
- THEN mismatch event is logged server-side with role, expected direction, actual direction, and user info

### Requirement: Split Mixed Entities

In EntityOnboardingModal, when a candidate has `creditPct >= 0.15 && debitPct >= 0.15`, the system MUST show a split option. The user selects a direction (credit or debit) → creates EntityContext with `{ pattern, role, transactionDirection }`. The other direction's transactions remain unclassified. On next scan, if the pattern+direction exists and opposite-direction unclassified transactions remain, the system prompts to create a separate entity for the remaining direction.

#### Scenario: Mixed entity shows split option

- GIVEN candidate with 60% credit / 40% debit
- WHEN rendered in EntityOnboardingModal
- THEN "Split into 2 entities?" button appears

#### Scenario: Dominant direction does not show split

- GIVEN candidate with 90% credit / 10% debit
- WHEN rendered
- THEN split button is hidden

#### Scenario: Successful split creates suffixed pattern

- GIVEN mixed candidate with pattern "OMAR MIRA"
- WHEN user splits keeping credits
- THEN EntityContext `{ pattern: "OMAR MIRA - ingresos", transactionDirection: "credit" }` is created
- AND debit transactions stay unclassified

#### Scenario: Split suggestion includes reasoning

- GIVEN an unmatched transaction is processed by the suggestion/detection flow
- WHEN the system identifies a candidate for a new rule or split
- THEN the suggestion card includes the proposed intent, GL account, direction, and entity pattern
- AND the card includes a brief explanation of why no existing rule matched (e.g., "No rule matching pattern 'JOHN DOE' found")
- AND the card displays "Confirm" and "Dismiss" buttons
- AND no automatic rule creation occurs until the user clicks confirm

#### Scenario: Split entity requires confirmation before rule creation

- GIVEN a confirmation card is shown to the user with split suggestions
- WHEN the user closes the modal or navigates away without clicking "Confirm"
- THEN no BankRule is created
- AND no side-effect mutations occur in the database
- AND the unmatched transaction remains unmatched

#### Scenario: Each split entity has independent intent

- GIVEN a mixed-direction entity being split into credit-only and debit-only
- WHEN the split entity cards are rendered
- THEN each card has its own intent dropdown
- AND the intent on one card can differ from the other
- AND each split entity separately requires confirmation before rule creation

### Requirement: Auto-Create BankRule on Classification

After `classifyEntity()` saves the EntityContext, it MUST auto-create a BankRule with:
- `pattern`, `glAccountId` from classification result
- `transactionDirection` inferred from `directionProfile` using the canonical `classifyDirection()` (`>= 0.8` threshold → `debit`/`credit`, else `any`)
- `priority=5`, `isActive=true`, `entityContextId` set to the new EntityContext id

#### Scenario: Classification creates BankRule with inferred direction

- GIVEN `classifyEntity()` returns `{ pattern: "ACME", glAccountId: "gl_001", directionProfile: { debitPct: 0.9, creditPct: 0.1 } }`
- WHEN auto-create runs after `saveEntityContext`
- THEN a BankRule is created with `pattern="ACME"`, `glAccountId="gl_001"`, `transactionDirection="debit"`, `entityContextId` set, `priority=5`, `isActive=true`

#### Scenario: Direction inference — credit dominant

- GIVEN `directionProfile` `debitPct=0.1, creditPct=0.9`
- WHEN auto-create computes direction
- THEN `transactionDirection = "credit"`

#### Scenario: Direction inference — mixed

- GIVEN `directionProfile` `debitPct=0.6, creditPct=0.4`
- WHEN auto-create computes direction
- THEN `transactionDirection = "any"`

#### Scenario: GL account not found during auto-create — classification persists, warning returned

- GIVEN `classifyEntity()` saves EntityContext first, THEN attempts auto-create with `glAccountId="gl_missing"`
- WHEN `gl_missing` does not exist in the database
- THEN the EntityContext IS persisted (no rollback)
- AND no BankRule is created
- AND the API response includes a `warning` field (not an error) informing that the rule was not created due to missing GL account

#### Scenario: Active rule with same `entityContextId` → skip

- GIVEN an active BankRule with `entityContextId="ctx_1"` exists
- WHEN `classifyEntity()` for the same context triggers auto-create
- THEN no new rule is created and the existing rule is unchanged

#### Scenario: Inactive rule with same `entityContextId` → reactivate + update

- GIVEN an inactive BankRule with `entityContextId="ctx_1"`, `pattern="OLD"`, `glAccountId="gl_old"`
- WHEN `classifyEntity()` for context `"ctx_1"` returns `pattern="NEW"`, `glAccountId="gl_new"`
- THEN the existing rule is set to `isActive=true`, `pattern="NEW"`, `glAccountId="gl_new"`

#### Scenario: Manual rule with same pattern — no dedup by pattern (design decision)

- GIVEN a manual BankRule with `entityContextId=null`, `pattern="ACME"`, `isManuallyEdited=true`
- WHEN `classifyEntity()` returns `pattern="ACME"` for a new context `"ctx_new"`
- THEN the manual rule is NOT modified
- AND a new BankRule is created with `pattern="ACME"`, `entityContextId="ctx_new"` (dedup is by `entityContextId`, not pattern)

#### Scenario: autoCreateRule includes intent value

- GIVEN `autoCreateRule()` in `entity-classifier.ts` creates a new BankRule
- WHEN the caller provides an intent value
- THEN the new BankRule record includes the intent value
- AND when no intent is provided, the rule is created with `intent = null`
- AND the intent field does not affect the matching engine behavior

#### Scenario: Source guard blocks autoCreateRule for AI suggestions

- GIVEN an LLM-suggested role response with `confidence: 0.69`
- WHEN the suggestion is presented to the user via the batch result banner
- THEN no automatic call to `autoCreateRule()` occurs
- AND the user must explicitly click "Accept" / "Confirm" before the rule is created
- AND `classifyEntity()` only invokes `autoCreateRule()` when the source is `user`, not `ai`
- AND when `source === 'user'`: `autoCreateRule()` is called with intent (pass-through)
- AND when `source === 'ai'` or `source` is undefined/null: `autoCreateRule()` is NOT called
- AND the entity context is still saved regardless of source

### Requirement: Pending Entities Filter via FK

The pending entities endpoint `GET /api/learning/pending-entities` MUST filter entities using the `entityContextId` foreign key on `BankRule` instead of pattern-matching against `BankRule.conditionValue`. An entity is considered **covered** when there is an active BankRule with `entityContextId` pointing to that entity's `EntityContext.id`.

Covered entities MUST display a badge `"Ya cubierta"` in the UI. No entity MAY be hidden from the pending list — recall MUST be preferred over precision (all entities always visible, covered ones get the badge).

An entity whose only matching rule is inactive (`isActive=false`) MUST be treated as **actionable** (not covered). Manually created rules with `entityContextId=null` do NOT count as covering any entity.

#### Scenario: Entity with active rule shows with badge

- GIVEN an EntityContext "ctx_1" with pattern "ACME CORP"
- AND an active BankRule with `entityContextId="ctx_1"`
- WHEN `GET /api/learning/pending-entities` is called for the company
- THEN "ctx_1" appears in the response
- AND the response includes `covered: true`
- AND the UI renders a `"Ya cubierta"` badge

#### Scenario: Entity without rule shows as actionable

- GIVEN an EntityContext "ctx_2" with pattern "UNKNOWN VENDOR"
- AND no BankRule has `entityContextId="ctx_2"`
- WHEN the pending entities endpoint is called
- THEN "ctx_2" appears in the response
- AND `covered: false`
- AND the UI does NOT show a badge

#### Scenario: Entity with inactive rule shows as actionable

- GIVEN an EntityContext "ctx_3" with pattern "OLD ENTITY"
- AND a BankRule with `entityContextId="ctx_3"`, `isActive=false`
- WHEN the pending entities endpoint is called
- THEN "ctx_3" appears with `covered: false`
- AND the entity is available for re-classification

#### Scenario: No entity is hidden

- GIVEN a company with 50 pending entities, 15 of which have active rules
- WHEN the pending entities endpoint is called
- THEN the response contains all 50 entities
- AND exactly 15 have `covered: true`
- AND the remaining 35 have `covered: false`

#### Scenario: Manual rule with null entityContextId does not cover any entity

- GIVEN a manually created BankRule with `entityContextId=null`, `pattern="ACME"`
- AND no other rule references any entity with pattern "ACME"
- WHEN the pending entities endpoint is called
- THEN no entity is marked as covered for pattern "ACME"
