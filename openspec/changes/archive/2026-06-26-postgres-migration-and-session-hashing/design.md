# Design: postgres-migration-and-session-hashing

## Technical Approach

We will migrate the database provider from SQLite to PostgreSQL, transition floating-point monetary fields to precise decimals, and secure database-stored session tokens using SHA-256 hashing.

The implementation involves:
1. **Schema Definition**: Update the Prisma schema datasource provider to `"postgresql"` and define the 12 monetary fields as `Decimal` (`@db.Decimal(18, 2)`). Ensure that tables for `EntityContext`, `SystemMemory`, `BankProfile`, and `RateLimit` are fully migrated to the PostgreSQL target database.
2. **Database Client Initialization**: Clean up `src/lib/db.ts` to remove the SQLite WAL mode command blocks and SQLite-specific connection optimizations.
3. **Session Token Hashing**: Update `src/lib/sessions.ts` to securely store SHA-256 hashes of generated session tokens. Keep function signatures backward-compatible.
4. **Cookie Standardization**: Change the session cookie name to `session_token` in login, register, logout, and proxy routes, as well as the test suites.
5. **Decimal Refactoring**: Update math/logic across API routes and services where fields now return `Prisma.Decimal` instances rather than JavaScript numbers. Convert decimals to numbers using `.toNumber()` for display, logic, or external serialization.
6. **PostgreSQL Test Environment**: Configure Vitest to use the PostgreSQL provider via the `DATABASE_URL` environment variable and remove local SQLite file cleanup steps.

---

## Architecture Decisions

### Decision: Database Migration to PostgreSQL
* **Choice**: PostgreSQL.
* **Alternatives considered**: SQLite (retaining it but scaling it, rejected due to scale limits and lack of native support for `@db.Decimal(18, 2)`).
* **Rationale**: Production readiness, high concurrency, and proper support for monetary data types.

### Decision: Precise Decimal Fields
* **Choice**: Convert the 12 primary monetary Float fields to `@db.Decimal(18, 2)` and parse them using `.toNumber()` on read where floating-point operations or display are required.
* **Rationale**: Eliminates rounding errors inherent in float representations for balances, credits, debits, and statement transactions.

### Decision: Secure Backward-Compatible Session Hashing
* **Choice**: Generate raw UUID session tokens, store the SHA-256 hex hash of the tokens in the database, and return the raw token to the client. Retrieve/delete sessions by hashing the incoming raw token and querying the database with it.
* **Rationale**: Prevents session hijacking in the event of database leakage, while preserving existing API and helper signatures.

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modify | Change provider to `"postgresql"`. Convert 12 monetary fields to `Decimal` with `@db.Decimal(18, 2)`. |
| `src/lib/db.ts` | Modify | Remove connection-time SQLite `PRAGMA` optimizations. |
| `src/lib/sessions.ts` | Modify | Add SHA-256 hashing using the native `crypto` module. Change cookie fallback from `'session'` to `'session_token'`. |
| `src/app/api/auth/login/route.ts` | Modify | Change set-cookie name to `'session_token'`. |
| `src/app/api/auth/register/route.ts` | Modify | Change set-cookie name to `'session_token'`. |
| `src/app/api/auth/logout/route.ts` | Modify | Change set-cookie name to `'session_token'`. |
| `src/proxy.ts` | Modify | Update middleware checks to extract `'session_token'` instead of `'session'`. |
| `src/app/api/dashboard/financial/route.ts` | Modify | Call `.toNumber()` on decimal properties: `initialBalance`, `debit`, `credit`, and `tx.amount`. |
| `src/app/api/accounts/route.ts` | Modify | Call `.toNumber()` on `debit` and `credit` when calculating `directBalance`. |
| `src/lib/services/closing-engine.ts` | Modify | Convert `debit` and `credit` group-by sum values from `Prisma.Decimal` to `number` using `.toNumber()`. |
| `src/lib/services/reconciliation.service.ts` | Modify | Convert `bankTx.amount` to number via `.toNumber()` before comparison or absolute value checks. |
| `src/app/api/reconciliation/periods/route.ts` | Modify | Convert `line.debit`/`line.credit` and statement/account balances to native numbers via `.toNumber()`. |
| `src/app/api/reconciliation/route.ts` | Modify | Convert `line.debit`/`line.credit`, statement/account balances, and transaction amounts to numbers via `.toNumber()`. |
| `src/app/api/reconciliation/auto/route.ts` | Modify | Convert `jl.debit`/`jl.credit`, transaction amounts, and rule amounts to numbers via `.toNumber()`. |
| `src/app/api/reconciliation/auto-preview/route.ts` | Modify | Convert `jl.debit`/`jl.credit` and transaction amounts to numbers via `.toNumber()`. |
| `src/app/api/ai-assistant/route.ts` | Modify | Convert mapped model decimal fields and aggregated amounts to numbers via `.toNumber()`. |
| `src/app/api/ai-rules/scan/route.ts` | Modify | Convert transaction amount to number via `.toNumber()` prior to clustering. |
| `src/app/api/learning/pending-entities/route.ts` | Modify | Convert transaction amount to number via `.toNumber()` prior to clustering. |
| `src/lib/services/entity-classifier.ts` | Modify | Convert transaction amount to number via `.toNumber()` prior to clustering. |
| `tests/setup.ts` | Modify | Remove setting `DATABASE_URL` to SQLite `file:./test.db`. |
| `tests/globalTeardown.ts` | Modify | Remove deletion of the SQLite `test.db` file. |
| `tests/middleware.test.ts` | Modify | Change mock cookies to `'session_token=abc123'`. |
| `tests/security.test.ts` | Modify | Change mock cookies to `'session_token=abc123'`. |
| `tests/integration/sqlite-wal-concurrency.test.ts` | Modify | Adapt test case to work with PostgreSQL provider. |

---

## Detailed Implementation Plans

### 1. `prisma/schema.prisma`
* Set `provider = "postgresql"` under `datasource db`.
* Apply `@db.Decimal(18, 2)` to:
  * `BankAccount`: `balance`, `initialBalance`
  * `BankStatement`: `openingBalance`, `closingBalance`, `totalCredits`, `totalDebits`
  * `BankTransaction`: `amount`
  * `ReconciliationPeriod`: `statementBalance`, `bookBalance`, `difference`
  * `JournalLine`: `debit`, `credit`

### 2. `src/lib/sessions.ts`
* Import `crypto` from Node's native `'crypto'` module.
* Replace direct database insertions and queries with hashed counterparts:
```typescript
const hashed = crypto.createHash('sha256').update(token).digest('hex');
```
* Keep signatures consistent:
  * `createSession(userId: string): Promise<string>` -> stores `hashed` version in `Session.token` field, returns raw `token`.
  * `destroySession(token: string): Promise<void>` -> hashes `token`, deletes matching record.
  * `getSessionUserId(request: NextRequest): Promise<string | null>` -> extracts raw token, hashes it, queries database.

### 3. Decimal Conversions (`.toNumber()`)
Everywhere a Decimal is retrieved and used in calculations, comparisons, or JSON structures expecting numbers:
* `l.debit.toNumber()` / `l.credit.toNumber()`
* `bankTx.amount.toNumber()`
* `bankAccount.balance.toNumber()`
* `statement.closingBalance.toNumber()`
* Sum/average/min/max aggregates: `aggregations._sum.amount?.toNumber() || 0`

---

## Testing Strategy

* **Unit and Integration Tests**: Ensure Vitest executes all database operations against the target PostgreSQL test database configured in the environment (`DATABASE_URL`).
* **Session and Cookie Verification**: Verify that proxy middleware and authentication routes function correctly using the standardized `session_token` cookie and that invalid tokens/expired sessions return 401s.
* **Decimal Math Checks**: Confirm that reconciliation and journal entry matching logic runs cleanly without typescript compilations or math runtime errors.

---

## Open Questions

None.
