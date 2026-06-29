# Delta for Direction Validation

## MODIFIED Requirements

### Requirement: REQ-VAL-01 — `roleIsValidForDirection()` is the canonical validator

The system MUST use `roleIsValidForDirection(role, directionProfile): boolean` from `src/lib/services/direction-filter.ts` as the single canonical direction-role validator. All callers MUST delegate to this function.
(Previously: `checkRoleDirectionMismatch()` in entity-enricher had its own implementation; direction-filter had a separate static check.)

`roleIsValidForDirection()` MUST return `true` when:
- Role is SOCIO (any direction)
- Role is OTRO (any direction)
- Role's `expectedDirection` matches the entity's `classifyDirection()` result

#### Scenario: SOCIO bypasses validation

- GIVEN role `SOCIO` and ANY DirectionProfile
- WHEN `roleIsValidForDirection` is called
- THEN it MUST return `true`

#### Scenario: OTRO bypasses validation

- GIVEN role `OTRO` and ANY DirectionProfile
- WHEN `roleIsValidForDirection` is called
- THEN it MUST return `true`

#### Scenario: Pure credit with debit role returns false

- GIVEN role `PROVEEDOR` (expectedDirection: debit) and DirectionProfile `{ creditPct: 0.95, debitPct: 0.05 }`
- WHEN `roleIsValidForDirection` is called
- THEN it MUST return `false`

#### Scenario: Pure debit with credit role returns false

- GIVEN role `CLIENTE` (expectedDirection: credit) and DirectionProfile `{ debitPct: 0.95, creditPct: 0.05 }`
- WHEN `roleIsValidForDirection` is called
- THEN it MUST return `false`

#### Scenario: Mixed direction with any role returns true

- GIVEN role `CLIENTE` and DirectionProfile `{ debitPct: 0.50, creditPct: 0.50 }`
- WHEN `roleIsValidForDirection` is called
- THEN it MUST return `true` (mixed direction accepts any role)

#### Scenario: Matching direction returns true

- GIVEN role `CLIENTE` (expectedDirection: credit) and DirectionProfile `{ creditPct: 0.90, debitPct: 0.10 }`
- WHEN `roleIsValidForDirection` is called
- THEN it MUST return `true`

## REMOVED Requirements

### Requirement: `checkRoleDirectionMismatch()` in entity-enricher

(Reason: Replaced by `roleIsValidForDirection()` as the canonical validator. The function was duplicated logic in entity-enricher that should have delegated to direction-filter.)
(Migration: All callers of `checkRoleDirectionMismatch()` MUST switch to `roleIsValidForDirection()`. The enrichment UI flow calls the canonical function via the enrichment service.)

## ADDED Requirements

### Requirement: REQ-VAL-03 — `validateDirectionProfile()` stays separate

The system MUST keep `validateDirectionProfile()` in `src/lib/services/direction-validation.ts` as a separate concern. This function validates GL account class consistency, NOT role-direction matching. It MUST NOT be merged with `roleIsValidForDirection()`.

#### Scenario: validateDirectionProfile handles GL class mismatch

- GIVEN a GL account with class `PASIVO` and a transaction with expected class `ACTIVO`
- WHEN `validateDirectionProfile` is called
- THEN it returns a mismatch for GL class consistency
- AND `roleIsValidForDirection()` is NOT called during this flow
