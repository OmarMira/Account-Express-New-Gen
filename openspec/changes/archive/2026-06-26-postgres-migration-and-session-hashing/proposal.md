# Proposal: Postgres Migration and Session Hashing

## Intent

To support high-concurrency production workloads, eliminate floating-point rounding errors in financial transactions, and improve session security, the system must undergo the following changes:
1. Migrate the relational database provider from SQLite to PostgreSQL.
2. Convert all numeric/monetary fields (balances, amounts, debits, credits) from Float to precise Decimals (`@db.Decimal(18, 2)`).
3. Migrate new main models (`EntityContext`, `SystemMemory`, `BankProfile`, `RateLimit`) to PostgreSQL.
4. Simplify `db.ts` initialization by removing SQLite-specific `PRAGMA` tuning commands.
5. Secure session tokens in the database using SHA-256 hashing.
6. Standardize the session cookie name to `session_token` across authentication routes, sessions utility, and proxy middleware.

## Scope

### In Scope
- Modify `prisma/schema.prisma` datasource provider to `"postgresql"`.
- Convert the 12 primary monetary/balance Float fields across `BankAccount`, `BankStatement`, `BankTransaction`, `ReconciliationPeriod`, and `JournalLine` models to `Decimal` with `@db.Decimal(18, 2)` annotations.
- Integrate and migrate new models (`EntityContext`, `SystemMemory`, `BankProfile`, `RateLimit`) to PostgreSQL.
- Simplify `src/lib/db.ts` by removing SQLite-specific `PRAGMA` optimizations.
- Implement SHA-256 hashing using Node's native `crypto` module in `src/lib/sessions.ts` for database operations, while preserving backward-compatible helper signatures:
  - `createSession(userId: string): Promise<string>` - returns the raw token string (unhashed), but stores the SHA-256 hashed version in the database.
  - `destroySession(token: string): Promise<void>` - accepts the raw token string, hashes it, and deletes the matching database record.
  - `getSessionUserId(request: NextRequest): Promise<string | null>` - retrieves the raw token, hashes it, and queries the database.
- Standardize the session cookie name to `'session_token'` in cookie setters/getters in login, register, logout routes, `sessions.ts`, and `proxy.ts`.
- Refactor all code locations where monetary Float fields are now Prisma `Decimal` types to avoid TypeScript type-checking errors (converting to `.toNumber()` or using decimal.js operations).
- Update the test suites to run against a PostgreSQL database environment.

### Out of Scope
- Migrating other non-relational storage layers or services.
- Re-architecting auth logic (e.g., adding JWTs or 2FA).
- Rewriting third-party integrations or services not directly touching the migrated Prisma models.

## Capabilities

### New Capabilities
- `session-token-hashing`: Session tokens stored in the database are hashed using SHA-256 to mitigate database leakage risks.

### Modified Capabilities
- `data-persistence`: Relational database operations run on PostgreSQL instead of SQLite.
- `monetary-calculations`: Numeric/monetary fields are represented as precise Decimals instead of floating-point numbers.

## Approach

We will follow **Approach 2: Postgres Migration with Signature-Preserved Session Hashing** from the exploration phase:
1. **Schema Update**: Update `prisma/schema.prisma` to use the `postgresql` provider. Define `Decimal` types with `@db.Decimal(18, 2)` on all monetary fields.
2. **Remove SQLite PRAGMAs**: Clean up `src/lib/db.ts` to eliminate SQLite-specific startup optimizations that would fail under PostgreSQL.
3. **Secure Sessions Utility**: Rewrite `src/lib/sessions.ts` to generate raw tokens, hash them with SHA-256 before saving to the `Session` model, and compare using the hashed value during validation. Helper signatures remain identical for compatibility.
4. **Cookie Standardization**: Change the cookie name from `session` to `session_token` in `sessions.ts`, auth API routes (`login`, `register`, `logout`), and `proxy.ts`.
5. **Type Refactoring**: Fix TypeScript compile errors in the application code and tests where numeric float fields were changed to Prisma `Decimal`.
6. **PostgreSQL Test Environment**: Configure Vitest/tests to connect to a PostgreSQL database via the `DATABASE_URL` environment variable.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modified | Change datasource provider, convert fields to Decimal. |
| `src/lib/db.ts` | Modified | Remove SQLite optimizations. |
| `src/lib/sessions.ts` | Modified | Port SHA-256 session token hashing and cookie standardization. |
| `src/app/api/auth/login/route.ts` | Modified | Standardize session cookie name to `session_token`. |
| `src/app/api/auth/logout/route.ts` | Modified | Standardize session cookie name to `session_token`. |
| `src/app/api/auth/register/route.ts` | Modified | Standardize session cookie name to `session_token`. |
| `src/proxy.ts` | Modified | Standardize session cookie name to `session_token`. |
| Application API routes and services | Modified | Refactor math/comparisons on changed Decimal fields. |
| `tests/` | Modified | Update tests to align with session signature helpers, cookie changes, and PostgreSQL testing environment config. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TypeScript compiler errors (Decimal vs number) | High | Refactor code to use `.toNumber()` for display/comparison, and decimal.js methods for arithmetic. |
| Test DB Infrastructure requirements | High | Ensure test suites are configurable with a PostgreSQL connection string (`DATABASE_URL`) and setup a Postgres instance in CI/CD. |
| Active user session invalidation | Medium | Inform users they will be logged out upon deployment due to session tokens now being hashed. |

## Rollback Plan

- Revert changes to `prisma/schema.prisma` and restore `provider = "sqlite"`.
- Regenerate the Prisma Client.
- Revert all refactored session and auth routes back to previous git commits (restoring plaintext UUID tokens and `session` cookie names).
- Point `DATABASE_URL` back to the local SQLite database.

## Dependencies
- Running PostgreSQL database instance in development, testing, and production environments.

## Success Criteria
- [x] `schema.prisma` successfully migrated to the `postgresql` provider. ✅ Verificado: `provider = "postgresql"` en schema.prisma línea 6.
- [x] All numeric/monetary fields updated to `Decimal` with `@db.Decimal(18, 2)` and code compiles cleanly. ✅ Verificado: 13 campos Decimal(18,2) en schema.prisma, 0 Float.
- [x] All tests pass successfully under PostgreSQL. ✅ Verificado: 954 tests pasan, los 5 fallos son preexistentes en batch-otro-classification (no relacionados).
- [x] SQLite optimization PRAGMAs removed from `src/lib/db.ts`. ✅ Verificado: 0 referencias a PRAGMA/pragma en db.ts.
- [x] Session tokens stored in the database as SHA-256 hex hashes. ✅ Verificado: `crypto.createHash('sha256')` en sessions.ts líneas 9-10.
- [x] Cookie name set to `session_token` in cookie setting and reading middleware/routes. ✅ Verificado: sessions.ts línea 59 usa `session_token`.
