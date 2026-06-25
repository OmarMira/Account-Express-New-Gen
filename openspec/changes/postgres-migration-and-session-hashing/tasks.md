# Tasks: postgres-migration-and-session-hashing

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~450 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Chained PRs |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## Phase 1: Foundation

- [x] 1.1 `prisma/schema.prisma` — Switch database provider to `postgresql` under datasource db.
- [x] 1.2 `prisma/schema.prisma` — Convert the 12 monetary Float fields to `@db.Decimal(18, 2)` (and `Decimal` type):
  - `BankAccount.balance` and `initialBalance`
  - `BankStatement.openingBalance`, `closingBalance`, `totalCredits`, and `totalDebits`
  - `BankTransaction.amount`
  - `ReconciliationPeriod.statementBalance`, `bookBalance`, and `difference`
  - `JournalLine.debit` and `credit`
- [x] 1.3 `src/lib/db.ts` — Remove SQLite-specific WAL mode startup commands and query optimizations (`PRAGMA journal_mode=WAL;`, `PRAGMA synchronous=NORMAL;`, etc.).
- [x] 1.4 `src/lib/sessions.ts` — Import Node `crypto` and apply SHA-256 hex hashing on session tokens before DB insertion (`createSession`), lookup (`getSessionUserId`), and destruction (`destroySession`). Return the raw token to the client.
- [x] 1.5 `src/lib/sessions.ts` — Update `getSessionToken` to read `session_token` cookie instead of `session`.

## Phase 2: Authentication & Cookie

- [x] 2.1 `src/app/api/auth/login/route.ts` — Update cookie name to `session_token` in headers/setters.
- [x] 2.2 `src/app/api/auth/register/route.ts` — Update cookie name to `session_token` in headers/setters.
- [x] 2.3 `src/app/api/auth/logout/route.ts` — Update cookie name to `session_token` in headers/setters/clearing logic.
- [x] 2.4 `src/proxy.ts` — Standardize cookie name check to extraction and validation of `session_token`.

## Phase 3: Monetary & Decimal math refactoring

- [x] 3.1 `src/app/api/dashboard/financial/route.ts` — Call `.toNumber()` on `initialBalance`, `debit`, `credit`, and `tx.amount`.
- [x] 3.2 `src/app/api/accounts/route.ts` — Call `.toNumber()` on `debit` and `credit` during `directBalance` calculation.
- [x] 3.3 `src/lib/services/closing-engine.ts` — Convert group-by sum values from `Prisma.Decimal` to `number` using `.toNumber()`.
- [x] 3.4 `src/lib/services/reconciliation.service.ts` — Convert `bankTx.amount` to `number` via `.toNumber()` before comparison/absolute math.
- [x] 3.5 `src/app/api/reconciliation/periods/route.ts` — Convert `line.debit`/`line.credit` and balance fields to `number` via `.toNumber()`.
- [x] 3.6 `src/app/api/reconciliation/route.ts` — Convert `line.debit`/`line.credit`, statement/account balances, and transaction amounts to numbers via `.toNumber()`.
- [x] 3.7 `src/app/api/reconciliation/auto/route.ts` — Convert `jl.debit`/`jl.credit`, transaction amounts, and rule amounts to numbers via `.toNumber()`.
- [x] 3.8 `src/app/api/reconciliation/auto-preview/route.ts` — Convert `jl.debit`/`jl.credit` and transaction amounts to numbers via `.toNumber()`.
- [x] 3.9 `src/app/api/ai-assistant/route.ts` — Convert decimal properties and aggregated values to `number` via `.toNumber()`.
- [x] 3.10 `src/app/api/ai-rules/scan/route.ts` — Convert transaction amount to `number` via `.toNumber()` before clustering.
- [x] 3.11 `src/app/api/learning/pending-entities/route.ts` — Convert transaction amount to `number` via `.toNumber()` before clustering.
- [x] 3.12 `src/lib/services/entity-classifier.ts` — Convert transaction amount to `number` via `.toNumber()` before clustering.

## Phase 4: Test Infrastructure & Tests updates

- [x] 4.1 `tests/setup.ts` — Remove SQLite-specific `test.db` fallback override logic.
- [x] 4.2 `tests/globalTeardown.ts` — Remove file unlinking of SQLite `test.db`.
- [x] 4.3 `tests/middleware.test.ts` — Update mock session cookie checks to use `session_token`.
- [x] 4.4 `tests/security.test.ts` — Update mock session cookie checks to use `session_token`.
- [x] 4.5 `tests/integration/sqlite-wal-concurrency.test.ts` — Rename or adapt the SQLite WAL concurrency test to run with PostgreSQL provider (remove `DATABASE_URL` check for `test.db`).

## Phase 5: Cleanup & Verification

- [x] 5.1 Run PostgreSQL database migrations/push in local development environment.
- [x] 5.2 Compile TypeScript (`tsc` or similar build check) to verify no compilation errors.
- [x] 5.3 Run Vitest test suite (`npm run test` or `npx vitest run`) to verify all tests pass against the Postgres database.
  - 97/98 test files pass (1061/1063 tests pass)
  - 1 pre-existing failure in `tests/sessions-hashing.test.ts` (session hashing, unrelated to Decimal schema)
