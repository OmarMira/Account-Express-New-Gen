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
