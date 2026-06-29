# Spec: Entity Direction Mismatch Warning

## Purpose

Alert users when an assigned role conflicts with the entity's transaction direction profile, preventing accidental misclassification.

## Requirement: Warning on Role Assignment

On create or edit, call `roleIsValidForDirection()` from `src/lib/services/direction-filter.ts` (the canonical validator). On mismatch, display yellow banner: "ⓘ El rol {role} espera transacciones de tipo {expected}, pero esta entidad tiene {actualPct}% de {actual}. ¿Asignar de todas formas?" User proceeds via explicitly labeled button.

#### Scenario: Warning shown for mismatch

- GIVEN user assigns CLIENTE to an entity with 100% debits
- WHEN `roleIsValidForDirection` returns `{ valid: false, reason: ... }`
- THEN yellow banner is displayed and user must confirm override

#### Scenario: SOCIO bypasses warning

- GIVEN user assigns SOCIO to entity with any direction profile
- WHEN `roleIsValidForDirection` returns `{ valid: true }`
- THEN no warning shown

#### Scenario: Warning logged on override

- GIVEN user clicks "Asignar de todas formas"
- WHEN entity is saved
- THEN mismatch event is logged server-side (role, expected, actual, user override)

## UI Contract

Non-blocking. Does not prevent save. Banner disappears on role change that resolves mismatch or on user dismissal.
