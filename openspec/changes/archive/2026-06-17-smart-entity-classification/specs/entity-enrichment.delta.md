# Delta: Entity Enrichment

## Modified: Direction Profile

`ROLE_ACCOUNT_MAP` gains `expectedDirection: 'credit' | 'debit' | 'mixed'` per role.

| Role | expectedDirection |
|------|-----------------|
| CLIENTE, INGRESO, INQUILINO | credit |
| PROVEEDOR, EMPLEADO, GASTO_OPERATIVO, TARJETA_CREDITO, PRESTAMO | debit |
| SOCIO | mixed |

#### Scenario: Direction mapped correctly

- GIVEN `ROLE_ACCOUNT_MAP` with `expectedDirection` for each role
- WHEN any role is looked up
- THEN `expectedDirection` matches the table above

## New Shared Validator

`checkRoleDirectionMismatch(role, directionProfile)` returns `{ mismatched: boolean, expected: string, actual: string }`. Pure function, no side effects. Called by both EntityOnboardingModal and EntityManagementPage edit flows.

#### Scenario: Mismatch detected

- GIVEN role CLIENTE (expected: credit) and directionProfile `{ creditPct: 0.1, debitPct: 0.9 }`
- WHEN `checkRoleDirectionMismatch` is called
- THEN `mismatched` is true, `expected` is "credit", `actual` is "debit"

#### Scenario: SOCIO never mismatches

- GIVEN role SOCIO (expected: mixed) and ANY directionProfile
- WHEN `checkRoleDirectionMismatch` is called
- THEN `mismatched` is always false
