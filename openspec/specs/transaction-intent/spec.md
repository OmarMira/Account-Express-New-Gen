# TransactionIntent Enum

## Purpose

Define the `TransactionIntent` enum as a shared source of truth at both the Zod (runtime validation) and Prisma (database-level integrity) layers. The enum captures the business purpose of a transaction — why money moved — with exactly 8 values. Bilingual labels (EN/ES) are provided for frontend display.

## Requirements

### Requirement: Dual Enum Definition

TransactionIntent MUST be defined as both a Zod enum (runtime validation) and a Prisma enum (DB-level integrity).

#### Scenario: Shared enum definition

- GIVEN a new file `src/lib/constants/transaction-intent.ts`
- WHEN it exports `TRANSACTION_INTENT_VALUES` as a const array of the 8 strings
- AND exports a Zod schema `transactionIntentSchema` using `z.enum(TRANSACTION_INTENT_VALUES)`
- THEN both backend and frontend can import and use the same enum definition
- AND a TypeScript type `TransactionIntent` is derived from `typeof TRANSACTION_INTENT_VALUES[number]`

#### Scenario: Prisma enum matches Zod enum

- GIVEN the Prisma schema declares `enum TransactionIntent { LOAN_PAYMENT RENT_PAYMENT OPERATING_EXPENSE OWNER_CONTRIBUTION CUSTOMER_PAYMENT TRANSFER TAX_PAYMENT OTHER }`
- WHEN `prisma migrate dev` is executed
- THEN the migration creates a native PostgreSQL enum type `TransactionIntent`
- AND the enum values are identical to the Zod enum values
- AND both layers reject any value not in the set

#### Scenario: Consistency test between Zod and Prisma enums

- GIVEN Prisma does NOT derive enum values from TypeScript — both must be maintained separately
- WHEN a test at `tests/constants/transaction-intent.test.ts` runs
- THEN it reads the Prisma-generated types (via `import { TransactionIntent } from '@prisma/client'`)
- AND compares them against the TypeScript const array `TRANSACTION_INTENT_VALUES`
- AND fails if any value differs between the two sources
- AND fails if new values are added to one but not the other

### Requirement: Enum Values

The enum MUST contain exactly these 8 values in this order: LOAN_PAYMENT, RENT_PAYMENT, OPERATING_EXPENSE, OWNER_CONTRIBUTION, CUSTOMER_PAYMENT, TRANSFER, TAX_PAYMENT, OTHER.

#### Scenario: All 8 values are defined

- GIVEN the `TRANSACTION_INTENT_VALUES` const array
- WHEN inspected at runtime
- THEN it contains exactly 8 string values
- AND each value is in UPPER_SNAKE_CASE
- AND the 8 values match the defined set exactly

### Requirement: Shared Location

The enum MUST be in a shared location importable by both backend services and frontend components.

#### Scenario: Importable from both layers

- GIVEN the file `src/lib/constants/transaction-intent.ts`
- WHEN imported from a backend service (e.g., `entity-classifier.ts`)
- THEN the import succeeds and the Zod enum and type are available
- WHEN imported from a frontend component (e.g., `EntityOnboardingModal.tsx`)
- THEN the import succeeds and the const array is available for rendering dropdown options

### Requirement: Bilingual Labels

Bilingual labels (EN/ES) MUST be defined for each intent value for UI display.

#### Scenario: Bilingual labels

- GIVEN the i18n files `src/i18n/locales/en.ts` and `src/i18n/locales/es.ts`
- WHEN flat keys `transactionIntent.{VALUE}` are added to each locale file
- THEN English labels read:
  - `LOAN_PAYMENT` → "Loan Payment"
  - `RENT_PAYMENT` → "Rent Payment"
  - `OPERATING_EXPENSE` → "Operating Expense"
  - `OWNER_CONTRIBUTION` → "Owner Contribution"
  - `CUSTOMER_PAYMENT` → "Customer Payment"
  - `TRANSFER` → "Transfer"
  - `TAX_PAYMENT` → "Tax Payment"
  - `OTHER` → "Other"
- AND Spanish labels read:
  - `LOAN_PAYMENT` → "Pago de Préstamo"
  - `RENT_PAYMENT` → "Pago de Renta"
  - `OPERATING_EXPENSE` → "Gasto Operativo"
  - `OWNER_CONTRIBUTION` → "Aporte del Dueño"
  - `CUSTOMER_PAYMENT` → "Pago de Cliente"
  - `TRANSFER` → "Transferencia"
  - `TAX_PAYMENT` → "Pago de Impuesto"
  - `OTHER` → "Otro"
- AND the i18n key pattern is `transactionIntent.{VALUE}` — flat key in each locale file

### Requirement: Non-Destructive Migration

The Prisma migration MUST be non-destructive (add-only, no data loss).

#### Scenario: Non-destructive migration

- GIVEN an existing production database with BankRule records
- WHEN the Prisma migration adds `enum TransactionIntent` and the optional field on BankRule
- THEN no existing data is modified
- AND existing BankRule records have `intent = null`
- AND the migration can be rolled back by reverting the schema and generating a down migration

## Constraints

- The const array is the TypeScript source of truth. Prisma enum must be maintained separately (Prisma does NOT derive from TypeScript). A consistency test ensures both stay in sync.
- Do NOT use `String` type for intent — the Prisma enum ensures DB-level integrity.
- The enum values follow UPPER_SNAKE_CASE convention.
- Bilingual labels use existing i18n infrastructure (`src/i18n/locales/{es,en}.ts`), following the flat object key pattern of the existing codebase.
- No bilingual label map lives in the constants file — labels are exclusively in i18n locale files.
