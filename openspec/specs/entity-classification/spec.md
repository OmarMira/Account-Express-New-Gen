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

The Zod schema in `entity-context.ts` MUST validate the `role` field against `ENTITY_ROLES` using `z.enum()`. Validation MUST reject any value not present in the shared constant. This validation MUST apply to new record creation only — existing database records MUST NOT be re-validated.

#### Scenario: Valid role passes validation

- GIVEN a valid role from `ENTITY_ROLES`
- WHEN creating an EntityContext record via the Zod schema
- THEN validation MUST pass

#### Scenario: Invalid role is rejected

- GIVEN a role value not present in `ENTITY_ROLES`
- WHEN creating an EntityContext record via the Zod schema
- THEN validation MUST fail with an error indicating the role is invalid

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
