# Domain 2: BankRule intent Field

## Overview

Add an optional `intent TransactionIntent?` field to the `BankRule` Prisma model. This connects the rule's semantic purpose to the TransactionIntent enum without changing any existing matching logic. Existing rules remain unaffected (null intent). API responses and mutations include the field.

## Requirements

| ID | Description | Priority |
|---|---|---|
| REQ-INTENT-01 | BankRule model gains optional field `intent TransactionIntent?` | P0 |
| REQ-INTENT-02 | Existing rules have null intent (no backfill needed) | P0 |
| REQ-INTENT-03 | API responses for BankRule include the intent field | P1 |
| REQ-INTENT-04 | Creating/updating a rule via API accepts optional intent | P1 |

## Scenarios

### SCEN-INTENT-01: intent field on BankRule schema

**Given** the current BankRule model at `prisma/schema.prisma`
**When** the field `intent TransactionIntent?` is added
**Then** the generated migration produces `ALTER TABLE "BankRule" ADD COLUMN "intent" "TransactionIntent"`
**And** the column is nullable (no `NOT NULL` or default value)
**And** `prisma db validate` passes without errors

### SCEN-INTENT-02: Existing rules are unaffected

**Given** a database with 100 BankRule records that existed before the migration
**After** running `prisma migrate dev`
**Then** querying `SELECT intent FROM "BankRule"` returns NULL for all 100 rows
**And** no data migration or backfill script is executed
**And** the application continues to match transactions using existing rules without reading the intent field

### SCEN-INTENT-03: API response includes intent

**Given** a GET /api/bank-rules endpoint that returns BankRule records
**When** a rule has `intent: "RENT_PAYMENT"`
**Then** the JSON response includes `"intent": "RENT_PAYMENT"`
**And** when intent is null, the response includes `"intent": null`
**And** existing API consumers that do not read the `intent` field continue to work

### SCEN-INTENT-04: API accepts intent on create/update

**Given** a POST/PUT /api/bank-rules endpoint
**When** the request body includes `"intent": "RENT_PAYMENT"`
**Then** the created/updated rule has `intent = "RENT_PAYMENT"`
**And** when the request body omits `intent`, the rule has `intent = null`
**And** when the request body includes an invalid intent value, the API returns a 400 validation error

### SCEN-INTENT-05: autoCreateRule includes intent

**Given** `autoCreateRule()` in `entity-classifier.ts` creates a new BankRule
**When** the caller provides an intent value
**Then** the new BankRule record includes the intent value
**And** when no intent is provided, the rule is created with `intent = null`

## Constraints

- The field is OPTIONAL — backward compatible. No existing code or data breaks.
- No changes to `rule-matching-engine.ts`. The intent field is stored but NOT read by the matching engine in this change.
- API validation uses the shared `transactionIntentSchema` Zod schema to validate incoming intent values.

## Files Affected

| File | Action |
|------|--------|
| `prisma/schema.prisma` | **Modified** — add `intent TransactionIntent?` to BankRule |
| `src/lib/services/entity-classifier.ts` | **Modified** — pass intent through `autoCreateRule()` |
| `src/app/api/bank-rules/route.ts` (or equivalent) | **Modified** — include intent in API response and accept in mutations |
