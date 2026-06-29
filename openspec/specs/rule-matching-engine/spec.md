# Rule Matching Engine Specification

## Purpose

Canonical matching engine that replaces three diverging implementations (`rule-matching-engine.ts`, `import.service.ts`, `entity-classifier.ts`). All consumers MUST delegate to this single engine, ensuring identical results for the same input.

## Requirements

### Requirement: Normalized Matching

All string comparisons MUST be case-insensitive, trimmed of leading/trailing whitespace, and whitespace-collapsed (multiple spaces replaced with a single space) before evaluation.

#### Scenario: Case and whitespace invariance

- GIVEN a rule with condition `description CONTAINS "  INTERES  "`
- WHEN a transaction with description `"interes bancario"` is matched
- THEN the engine MUST match it (lowercased, trimmed, collapsed)

#### Scenario: Empty condition

- GIVEN a rule with an empty condition string
- WHEN the engine evaluates it
- THEN the rule MUST be skipped silently

### Requirement: Priority-Based Scoring

Each match attempt MUST compute a score using role hierarchy. Priorities MUST be loaded via `loadRolePriorities()` with async TTL caching — this method MUST NOT block the event loop (`readFileSync` is forbidden).

#### Scenario: Higher-priority role wins

- GIVEN two rules matching the same transaction with roles at priority 1 and 10
- WHEN the engine ranks matches
- THEN the rule with priority 10 MUST be returned first

#### Scenario: Same priority — first-match-wins

- GIVEN two rules with the same priority matching the same transaction
- WHEN the engine evaluates
- THEN the first rule inserted for that company MUST win

### Requirement: First-Match-Wins Semantics

The engine MUST return exactly one matching rule per transaction (the highest-scoring match). If no rules match, the engine MUST return `null`.

#### Scenario: No matching rule

- GIVEN a transaction with no matching rules for the company
- WHEN the engine evaluates
- THEN it MUST return `null`

### Requirement: Wildcard and Overlapping Rules

A wildcard condition (e.g., `*`) SHOULD match any non-empty value. Overlapping rules MUST be resolved by priority then insertion order — no silent override.

#### Scenario: Wildcard matches any value

- GIVEN a rule with condition `*` for value
- WHEN any transaction with a non-empty value is evaluated
- THEN the rule SHOULD match

### Requirement: Name Uniqueness on PUT

When creating or updating a bank rule via `PUT /api/bank-rules/[id]`, the engine MUST reject a name that duplicates another rule within the same company. The response MUST be `409 Conflict` with a message via `t('bankRules.errors.duplicateName')`.

#### Scenario: Duplicate name rejected

- GIVEN an existing rule with name "Intereses" for company A
- WHEN a PUT request creates a rule with name "Intereses" for company A
- THEN the response MUST be `409 Conflict`
- AND the error message MUST use `t('bankRules.errors.duplicateName')`

#### Scenario: Same name, different company

- GIVEN an existing rule with name "Intereses" for company A
- WHEN a PUT request creates a rule with name "Intereses" for company B
- THEN the request MUST succeed (no collision)

### Requirement: All Mutations Go Through the Engine

Every create, update, and delete operation for bank rules MUST pass through the unified engine. Direct Prisma manipulation in route handlers is forbidden.

### Requirement: i18n for All Messages

All user-facing messages, warnings, and errors produced by this engine MUST use `t()` keys from `src/i18n/locales/{es,en}.ts`. Hardcoded strings are forbidden.

#### Scenario: Missing translation key

- GIVEN a locale file that is missing a key referenced by the engine
- WHEN that message is triggered
- THEN the system SHOULD fall back to the default locale gracefully without crashing

### Requirement: BankRule Schema Extensions

BankRule gains `entityContextId` (`String?`, FK to EntityContext, NO unique constraint), `isManuallyEdited` (`Boolean`, `@default(false)`), and `intent` (`TransactionIntent?`, optional semantic purpose). GET `/api/bank-rules` MUST include all these fields in the response shape. Matching logic is unaffected — these fields do not participate in rule evaluation.

#### Scenario: GET exposes `entityContextId`

- GIVEN a BankRule with `entityContextId="ctx_1"`
- WHEN GET `/api/bank-rules/[id]`
- THEN response JSON includes `entityContextId: "ctx_1"`

#### Scenario: `entityContextId` is null for manual rules

- GIVEN a manually created BankRule (no classification origin)
- WHEN fetched via GET
- THEN `entityContextId` is null

#### Scenario: intent field on BankRule schema

- GIVEN the current BankRule model at `prisma/schema.prisma`
- WHEN the field `intent TransactionIntent?` is added
- THEN the generated migration produces `ALTER TABLE "BankRule" ADD COLUMN "intent" "TransactionIntent"`
- AND the column is nullable (no `NOT NULL` or default value)
- AND `prisma db validate` passes without errors

#### Scenario: Existing rules are unaffected

- GIVEN a database with BankRule records that existed before the migration
- AFTER running `prisma migrate dev`
- THEN querying `SELECT intent FROM "BankRule"` returns NULL for all rows
- AND no data migration or backfill script is executed
- AND the application continues to match transactions using existing rules without reading the intent field

#### Scenario: API response includes intent

- GIVEN a GET /api/bank-rules endpoint that returns BankRule records
- WHEN a rule has `intent: "RENT_PAYMENT"`
- THEN the JSON response includes `"intent": "RENT_PAYMENT"`
- AND when intent is null, the response includes `"intent": null`
- AND existing API consumers that do not read the `intent` field continue to work

#### Scenario: API accepts intent on create/update

- GIVEN a POST/PUT /api/bank-rules endpoint
- WHEN the request body includes `"intent": "RENT_PAYMENT"`
- THEN the created/updated rule has `intent = "RENT_PAYMENT"`
- AND when the request body omits `intent`, the rule has `intent = null`
- AND when the request body includes an invalid intent value, the API returns a 400 validation error

### Requirement: Differential PATCH Sets `isManuallyEdited=true`

PATCH `/api/bank-rules/[id]` MUST set `isManuallyEdited=true` when any field OTHER than `isActive` changes. Changing only `isActive` MUST NOT flip the flag.

#### Scenario: Non-isActive field change marks rule as manually edited

- GIVEN a BankRule with `isManuallyEdited=false`, `entityContextId="ctx_1"`
- WHEN PATCH updates `pattern` from `"OLD"` to `"NEW"`
- THEN `isManuallyEdited=true` is persisted

#### Scenario: Only `isActive` toggle does NOT mark manually edited

- GIVEN a BankRule with `isManuallyEdited=false`
- WHEN PATCH updates only `isActive` from `true` to `false`
- THEN `isManuallyEdited` remains `false`

### Requirement: FK Nullification on EntityContext Delete

`removeEntityContext()` and `bulkRemoveEntityContexts()` in `entity-context-crud-service.ts` MUST `UPDATE BankRule SET entityContextId=null WHERE entityContextId=<id>` BEFORE deleting the EntityContext. On FK nullification, an audit event MUST be logged recording the rule IDs and context deleted.

#### Scenario: Delete entity-context nullifies FK on linked rules

- GIVEN a BankRule with `entityContextId="ctx_1"`
- WHEN `removeEntityContext("ctx_1")` is called
- THEN `BankRule.entityContextId` is set to `null` BEFORE the EntityContext is deleted
- AND an audit event records the loss

#### Scenario: Delete with no linked rules succeeds

- GIVEN no BankRule has `entityContextId="ctx_1"`
- WHEN `removeEntityContext("ctx_1")` is called
- THEN EntityContext is deleted without side-effects

#### Scenario: Bulk delete with multiple linked rules nullifies all before delete

- GIVEN two BankRules with `entityContextId="ctx_1"` and a third with `entityContextId="ctx_2"`
- WHEN `bulkRemoveEntityContexts(["ctx_1", "ctx_2"])` is called
- THEN BankRules with `entityContextId="ctx_1"` and `entityContextId="ctx_2"` are all nullified to `null`
- AND both EntityContexts are deleted
- AND a single audit event records all affected rule IDs

### Requirement: Shared Normalization via `normalizePattern()`

The inline normalization in `evaluateCondition()` (lowercase + trim + collapse spaces) MUST be replaced with a call to the canonical `normalizePattern()` from `src/lib/services/pattern-normalizer.ts`. This ensures the rule-matching engine produces bitwise-identical normalized strings as all other detection pipelines.

The engine MUST call `normalizePattern()` on both the rule's condition value and the transaction's description value before comparison. All existing operators (`CONTAINS`, `EQUALS`, `STARTS_WITH`, `ENDS_WITH`) MUST operate on the normalized values.

#### Scenario: Normalized matching uses canonical function

- GIVEN a rule with condition `description CONTAINS "  INTERES  BANCARIO  "`
- AND a transaction with description `"INTERES BANCARIO."`
- WHEN `evaluateCondition()` evaluates the match
- THEN both values are normalized via `normalizePattern()` → `"interes bancario"`
- AND the CONTAINS match succeeds identically to pre-change behavior

#### Scenario: All operators use normalized values

- GIVEN a rule condition `STARTS_WITH "ACME "` and a transaction `"Acme Corp."`
- WHEN the engine evaluates the match
- THEN `normalizePattern("ACME ")` = `"acme"` and `normalizePattern("Acme Corp.")` = `"acme corp"`
- AND `"acme corp".startsWith("acme")` = true
- AND the match succeeds

#### Scenario: Consistent matching across pipelines

- GIVEN a rule condition and a transaction description
- WHEN both the rule-matching engine AND the entity classifier apply `normalizePattern()`
- THEN the normalized values are identical in both pipelines
