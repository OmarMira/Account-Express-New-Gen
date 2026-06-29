# Domain 1: TransactionIntent Enum

## Overview

Define the `TransactionIntent` enum as a shared source of truth at both the Zod (runtime validation) and Prisma (database-level integrity) layers. The enum captures the business purpose of a transaction — why money moved — with exactly 8 values. Bilingual labels (EN/ES) are provided for frontend display.

## Requirements

| ID | Description | Priority |
|---|---|---|
| REQ-ENUM-01 | TransactionIntent MUST be defined as both a Zod enum (runtime validation) and a Prisma enum (DB-level integrity) | P0 |
| REQ-ENUM-02 | The enum MUST contain exactly these 8 values: LOAN_PAYMENT, RENT_PAYMENT, OPERATING_EXPENSE, OWNER_CONTRIBUTION, CUSTOMER_PAYMENT, TRANSFER, TAX_PAYMENT, OTHER | P0 |
| REQ-ENUM-03 | The enum MUST be in a shared location importable by both backend services and frontend components | P0 |
| REQ-ENUM-04 | Bilingual labels (EN/ES) MUST be defined for each intent value for UI display | P0 |
| REQ-ENUM-05 | The Prisma migration MUST be non-destructive (add-only, no data loss) | P0 |

## Scenarios

### SCEN-ENUM-01: Shared enum definition

**Given** a new file `src/lib/constants/transaction-intent.ts`
**When** it exports `TRANSACTION_INTENT_VALUES` as a const array of the 8 strings
**And** exports a Zod schema `transactionIntentSchema` using `z.enum(TRANSACTION_INTENT_VALUES)`
**Then** both backend and frontend can import and use the same enum definition
**And** a TypeScript type `TransactionIntent` is derived from `typeof TRANSACTION_INTENT_VALUES[number]`

### SCEN-ENUM-02: Prisma enum matches Zod enum

**Given** the Prisma schema declares `enum TransactionIntent { LOAN_PAYMENT RENT_PAYMENT OPERATING_EXPENSE OWNER_CONTRIBUTION CUSTOMER_PAYMENT TRANSFER TAX_PAYMENT OTHER }`
**When** `prisma migrate dev` is executed
**Then** the migration creates a native PostgreSQL enum type `TransactionIntent`
**And** the enum values are identical to the Zod enum values
**And** both layers reject any value not in the set

### SCEN-ENUM-02b: Consistency test between Zod and Prisma enums

**Given** Prisma does NOT derive enum values from TypeScript — both must be maintained separately
**When** a test at `tests/constants/transaction-intent.test.ts` runs
**Then** it reads the Prisma-generated types (via `import { TransactionIntent } from '@prisma/client'`)
**And** compares them against the TypeScript const array `TRANSACTION_INTENT_VALUES`
**And** fails if any value differs between the two sources
**And** fails if new values are added to one but not the other

### SCEN-ENUM-03: Bilingual labels

**Given** the i18n files `src/i18n/locales/en.ts` and `src/i18n/locales/es.ts`
**When** flat keys `transactionIntent.{VALUE}` are added to each locale file
**Then** English labels read:
- `LOAN_PAYMENT` → "Loan Payment"
- `RENT_PAYMENT` → "Rent Payment"
- `OPERATING_EXPENSE` → "Operating Expense"
- `OWNER_CONTRIBUTION` → "Owner Contribution"
- `CUSTOMER_PAYMENT` → "Customer Payment"
- `TRANSFER` → "Transfer"
- `TAX_PAYMENT` → "Tax Payment"
- `OTHER` → "Other"

**And** Spanish labels read:
- `LOAN_PAYMENT` → "Pago de Préstamo"
- `RENT_PAYMENT` → "Pago de Renta"
- `OPERATING_EXPENSE` → "Gasto Operativo"
- `OWNER_CONTRIBUTION` → "Aporte del Dueño"
- `CUSTOMER_PAYMENT` → "Pago de Cliente"
- `TRANSFER` → "Transferencia"
- `TAX_PAYMENT` → "Pago de Impuesto"
- `OTHER` → "Otro"

**And** the i18n key pattern is `transactionIntent.{VALUE}` — flat key in each locale file. Example:
- `en.ts`: `transactionIntent.LOAN_PAYMENT = "Loan Payment"`
- `es.ts`: `transactionIntent.LOAN_PAYMENT = "Pago de Préstamo"`

### SCEN-ENUM-04: Non-destructive migration

**Given** an existing production database with BankRule records
**When** the Prisma migration adds `enum TransactionIntent` and the optional field on BankRule
**Then** no existing data is modified
**And** existing BankRule records have `intent = null`
**And** the migration can be rolled back by reverting the schema and generating a down migration

## Constraints

- The const array is the TypeScript source of truth. Prisma enum must be maintained separately (Prisma does NOT derive from TypeScript). A consistency test (SCEN-ENUM-02b) ensures both stay in sync.
- Do NOT use `String` type for intent — the Prisma enum ensures DB-level integrity.
- The enum values follow UPPER_SNAKE_CASE convention.
- Bilingual labels use existing i18n infrastructure (`src/i18n/locales/{es,en}.ts`), following the flat object key pattern of the existing codebase.

## Files Affected

| File | Action |
|------|--------|
| `src/lib/constants/transaction-intent.ts` | **New** — shared const array + Zod schema + type |
| `prisma/schema.prisma` | **Modified** — add `enum TransactionIntent` |
| `prisma/migrations/` | **New** — auto-generated migration |
| `src/i18n/locales/en.ts` | **Modified** — add `transactionIntent.*` keys |
| `src/i18n/locales/es.ts` | **Modified** — add `transactionIntent.*` keys |
