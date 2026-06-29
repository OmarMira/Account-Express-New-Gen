# SOCIO Conflict Detection Specification — Delta

## Purpose

Define the single extracted `entity-conflict-detector.ts` service that replaces 3 duplicate implementations of SOCIO conflict detection across the codebase. This is strictly a consolidation refactor — no behavioral changes, no new detection logic.

## Dependencies

- **Replaces**: `detectEntityConflict()` in `entity-classifier.ts`, `hasSocioConflict()` in `entity-enricher.ts`, `entityFirstCheck()` in `rule-matching-engine.ts`
- **Depends on**: `openspec/specs/rule-matching-engine/spec.md` (existing matching rules)
- **Depends on**: `openspec/specs/entity-classification/spec.md` (classification flow)
- **Depends on**: `openspec/specs/entity-enrichment/spec.md` (enrichment flow)

---

## Requirements

### REQ-SOCIO-01 — Single `detectConflict()` function

The system MUST expose a single exported function `detectConflict(companyId: string, pattern: string, description: string): Promise<ConflictResult>` at `src/lib/services/entity-conflict-detector.ts`.

The function SHALL:
1. Accept `companyId`, `pattern` (the normalized pattern from the transaction/rule), and `description` (raw description from the transaction)
2. Query active EntityContext records and active BankRules for the given `companyId`
3. Detect whether the transaction's description/pattern matches an existing SOCIO entity AND a non-SOCIO merchant/entity simultaneously
4. Return `{ conflict: boolean, socioEntity?: EntityContext, merchantEntity?: EntityContext, reason?: string }`

The function MUST produce bitwise-identical results to all 3 replaced implementations for the same inputs.

#### Scenario: SOCIO conflict detected (merchant vs SOCIO)

- GIVEN a transaction with description `"OMAR MIRA"` that matches:
  - EntityContext A with `role="SOCIO"`, `pattern="OMAR MIRA"`
  - EntityContext B with `role="PROVEEDOR"`, `pattern="OMAR MIRA"`
- WHEN `detectConflict("comp_1", normalizedPattern, rawDescription)` is called
- THEN `conflict` MUST be `true`
- AND `socioEntity` MUST contain EntityContext A
- AND `merchantEntity` MUST contain EntityContext B

#### Scenario: No conflict when only SOCIO exists

- GIVEN a transaction matching only a SOCIO entity
- WHEN `detectConflict` is called
- THEN `conflict` MUST be `false`
- AND `socioEntity` MUST be the matched SOCIO

#### Scenario: No conflict when only merchant exists

- GIVEN a transaction matching only a non-SOCIO entity
- WHEN `detectConflict` is called
- THEN `conflict` MUST be `false`
- AND `merchantEntity` MUST be null

#### Scenario: No match returns no conflict

- GIVEN a transaction matching no existing entities
- WHEN `detectConflict` is called
- THEN `conflict` MUST be `false`
- AND both `socioEntity` and `merchantEntity` MUST be null

---

### REQ-SOCIO-02 — Replaces 3 call sites with identical behavior

The following call sites MUST be replaced by a single call to `detectConflict()`:

| # | File | Function | Lines (approx) |
|---|------|----------|---------------|
| 1 | `entity-classifier.ts` | `detectEntityConflict()` | ~30 |
| 2 | `entity-enricher.ts` | `hasSocioConflict()` | ~25 |
| 3 | `rule-matching-engine.ts` | `entityFirstCheck()` (relevant section) | ~20 |

The three old functions MUST be removed. All callers MUST import and call `detectConflict()` from the single module.

#### Scenario: All 3 call sites produce same result for same input

- GIVEN the same `(companyId, pattern, description)` triple
- WHEN `detectConflict` is called
- THEN the result MUST be identical to what each of the 3 old functions would have returned for that same input
- AND the replacement is verified by comparing recorded outputs against a known test fixture

#### Scenario: entity-classifier delegates to conflict detector

- GIVEN the `classifyEntity()` flow detects a potential SOCIO/merchant conflict
- AFTER the change, the flow calls `detectConflict()` instead of the old `detectEntityConflict()`
- WHEN the result is `{ conflict: true, socioEntity, merchantEntity }`
- THEN the classification flow behaves exactly as it did before the change

---

### REQ-SOCIO-03 — `entityFirstMode` flag checked consistently

The `detectConflict()` function MUST check the `entityFirstMode` flag: if `entityFirstMode` is enabled for the company, the function MUST prioritize entity-context matches over rule-based matches (i.e., if a BankRule matches but the entity-context says the pattern should be classified differently, entity-context wins).

This flag MUST be checked by the single `detectConflict()` function — not by callers. This fixes Inconsistency I9 from the exploration: the old `entityFirstCheck()` in rule-matching-engine checked the flag, but `detectEntityConflict()` in entity-classifier and `hasSocioConflict()` in entity-enricher did NOT.

#### Scenario: entityFirstMode flag respected consistently

- GIVEN company "comp_1" with `entityFirstMode=true`
- AND a BankRule matches pattern "MERCADO LIBRE" → role CLIENTE
- AND an EntityContext matches same pattern → role SOCIO
- WHEN `detectConflict` is called
- THEN the EntityContext (SOCIO) MUST take precedence
- AND `conflict` MUST be `true` reflecting entity-context resolution

#### Scenario: entityFirstMode=false uses rule-first resolution

- GIVEN company "comp_1" with `entityFirstMode=false`
- AND a BankRule matches pattern "MERCADO LIBRE" → role CLIENTE
- AND an EntityContext matches same pattern → role SOCIO
- WHEN `detectConflict` is called
- THEN the BankRule result MUST take precedence
- AND `conflict` resolution follows the rule-first path

#### Scenario: entityFirstMode not set defaults to false

- GIVEN company "comp_1" has no `entityFirstMode` configuration
- WHEN `detectConflict` is called
- THEN the function MUST behave as if `entityFirstMode=false`
- AND no error is thrown

---

## Non-Goals

- New conflict detection logic or algorithms (strictly a consolidation refactor)
- Direction conflict detection (separate domain, covered by direction-mismatch spec)
- Any behavioral change to how conflicts affect classification or matching results
