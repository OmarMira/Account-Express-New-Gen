# Entity Enrichment Specification

## Purpose

Define reusable pure functions that decorate entity candidates with GL account suggestions, role priority resolution, and direction profiles. Extracted from the scan route into testable, caller-independent enrichment.

## Requirements

### Requirement: GL Account Suggestion

The system MUST provide `suggestAccount(candidate, roleAccountMap)` returning the best matching GL account ID or `null`.

Search order SHALL be: keyword match against candidate description/name, then role-based default from `ROLE_ACCOUNT_MAP`, then `null`.

#### Scenario: Keyword match resolves account

- GIVEN candidate description "ACME CORP SA" and `ROLE_ACCOUNT_MAP` with a keyword "ACME" → account "gla_001"
- WHEN `suggestAccount` is called
- THEN `"gla_001"` is returned

#### Scenario: Fallback to role default

- GIVEN candidate with role PROVEEDOR, description "UNKNOWN VENDOR", no keyword match, but `ROLE_ACCOUNT_MAP["PROVEEDOR"]` exists
- WHEN `suggestAccount` is called
- THEN the PROVEEDOR default account is returned

#### Scenario: No match returns null

- GIVEN a candidate with no keyword match and no role default
- WHEN `suggestAccount` is called
- THEN `null` is returned

### Requirement: Role Priority Resolution

The system MUST provide `resolveRolePriority(candidate, entityContexts)` returning the effective role. If an EntityContext record exists for the candidate's normalized pattern + company, its role SHALL override the detected role.

#### Scenario: Existing context overrides detected role

- GIVEN candidate detected as CLIENTE, but EntityContext exists with role PROVEEDOR for same pattern+company
- WHEN `resolveRolePriority` is called
- THEN `"PROVEEDOR"` is returned

#### Scenario: No context uses detected role

- GIVEN a candidate with detected role PROVEEDOR and no matching EntityContext
- WHEN `resolveRolePriority` is called
- THEN `"PROVEEDOR"` is returned

### Requirement: Direction Profile

The system MUST provide `resolveDirection(candidate)` returning `"debit"`, `"credit"`, or `null` based on the candidate's resolved role and transaction type.

`ROLE_ACCOUNT_MAP` MUST include an `expectedDirection` field for each role: `'credit'`, `'debit'`, or `'mixed'`.

| Role | expectedDirection |
|------|-----------------|
| CLIENTE, INGRESO, INQUILINO | credit |
| PROVEEDOR, EMPLEADO, GASTO_OPERATIVO, TARJETA_CREDITO, PRESTAMO | debit |
| SOCIO | mixed |

#### Scenario: Known role resolves direction

- GIVEN a candidate with role PROVEEDOR
- WHEN `resolveDirection` is called
- THEN the configured direction for PROVEEDOR (e.g., `"credit"`) is returned

#### Scenario: Unknown role returns null

- GIVEN a candidate with role OTRO or IGNORADA
- WHEN `resolveDirection` is called
- THEN `null` is returned

#### Scenario: Direction mapped correctly

- GIVEN `ROLE_ACCOUNT_MAP` with `expectedDirection` for each role
- WHEN any role is looked up
- THEN `expectedDirection` matches the expected-direction table above

### Requirement: Role-Direction Mismatch Detection

The system MUST provide `checkRoleDirectionMismatch(role, directionProfile)` returning `{ mismatched: boolean, expected: string, actual: string } | null`. This is a pure function with no side effects, callable from both backend (entity-enricher) and frontend (EntityOnboardingModal, EntityManagementPage).

When `expectedDirection` conflicts with the entity's direction profile (e.g., role expects credits but entity has 90% debits), `mismatched` MUST be `true`. SOCIO (expectedDirection: mixed) MUST never mismatch. OTRO/IGNORADA (null expectedDirection) MUST never mismatch.

#### Scenario: Mismatch detected

- GIVEN role CLIENTE (expected: credit) and directionProfile `{ creditPct: 0.1, debitPct: 0.9 }`
- WHEN `checkRoleDirectionMismatch` is called
- THEN `mismatched` is true, `expected` is "credit", `actual` is "debit"

#### Scenario: SOCIO never mismatches

- GIVEN role SOCIO (expected: mixed) and ANY directionProfile
- WHEN `checkRoleDirectionMismatch` is called
- THEN `mismatched` is always false

### Requirement: Per-Candidate Enrichment

Enrichment MUST run once per unique candidate, not once per transaction. The same candidate appearing in multiple transactions SHALL be enriched exactly once.

#### Scenario: Deduplicated enrichment

- GIVEN 10 transactions all matching the same candidate entity
- WHEN enrichment is applied
- THEN `suggestAccount` and `resolveRolePriority` are each called exactly once for that candidate
