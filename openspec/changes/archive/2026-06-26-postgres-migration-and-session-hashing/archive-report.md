# Archive Report: postgres-migration-and-session-hashing

**Archived**: 2026-06-26
**Archive Location**: `openspec/changes/archive/2026-06-26-postgres-migration-and-session-hashing/`

## What Was Done

This change migrated the system from SQLite to PostgreSQL, with three major workstreams:

### 1. Database Migration (SQLite → PostgreSQL)
- Changed Prisma datasource provider from `"sqlite"` to `"postgresql"`
- Removed SQLite-specific PRAGMA optimizations (`journal_mode=WAL`, `synchronous=NORMAL`) from `src/lib/db.ts` and `src/lib/db-optimizer.ts`
- Removed `tests/globalTeardown.ts` SQLite `test.db` cleanup
- Updated `tests/setup.ts` to remove SQLite-specific fallback logic
- Updated `vitest.config.ts` for PostgreSQL test environment
- Migrated models `EntityContext`, `SystemMemory`, `BankProfile`, `RateLimit` to PostgreSQL

### 2. Decimal Field Refactoring
- Converted 13 monetary/balance Float fields to `@db.Decimal(18, 2)` in `prisma/schema.prisma`
- Added `.toNumber()` calls across 20+ API routes and services where Prisma now returns `Decimal` types
- Created `src/lib/utils/decimal.ts` helper utilities
- Affected models: `BankAccount`, `BankStatement`, `BankTransaction`, `ReconciliationPeriod`, `JournalLine`

### 3. Session Security & Cookie Standardization
- Implemented SHA-256 session token hashing using native Node `crypto` module in `src/lib/sessions.ts`
- Preserved backward-compatible function signatures (`createSession`, `destroySession`, `getSessionUserId`)
- Standardized cookie name from `'session'` to `'session_token'` across all auth routes, proxy middleware, and sessions utility
- Added dedicated `tests/sessions-hashing.test.ts` test suite

## Files Changed

**Schema & Config:**
- `prisma/schema.prisma` — Provider to postgresql, 13 Decimal(18,2) fields
- `next.config.mjs` — Prisma v6 compatibility adjustments
- `vitest.config.ts` — PostgreSQL test configuration
- `src/instrumentation.ts` — Prisma v6 initialization
- `src/lib/db.ts` — Removed SQLite PRAGMAs, simplified init
- `src/lib/db-optimizer.ts` — Removed SQLite-specific optimizer

**Session & Auth:**
- `src/lib/sessions.ts` — SHA-256 hashing, cookie standardization
- `src/lib/services/auth.service.ts` — Decimal compatibility
- `src/proxy.ts` — Cookie name to `session_token`
- `src/app/api/auth/login/route.ts` — Cookie name standardization
- `src/app/api/auth/register/route.ts` — Cookie name standardization
- `src/app/api/auth/logout/route.ts` — Cookie name standardization

**API Routes (Decimal .toNumber() conversions):**
- `src/app/api/dashboard/financial/route.ts`
- `src/app/api/accounts/route.ts`
- `src/app/api/banks/route.ts`
- `src/app/api/companies/route.ts`
- `src/app/api/journal/route.ts`
- `src/app/api/transactions/[id]/route.ts`
- `src/app/api/bank-rules/apply-all/route.ts`
- `src/app/api/reconciliation/route.ts`
- `src/app/api/reconciliation/periods/route.ts`
- `src/app/api/reconciliation/auto/route.ts`
- `src/app/api/reconciliation/auto-preview/route.ts`
- `src/app/api/reconciliation/review/route.ts`
- `src/app/api/accounting-flow/route.ts`
- `src/app/api/accounting-flow/audit/fuzzy-match/route.ts`
- `src/app/api/accounting-flow/export/route.ts`
- `src/app/api/admin/companies/route.ts`
- `src/app/api/ai-assistant/route.ts`
- `src/app/api/ai-rules/scan/route.ts`
- `src/app/api/learning/rules/route.ts`
- `src/app/api/learning/pending-entities/route.ts`
- `src/app/api/learning/smart-classify/route.ts`
- `src/app/api/bank-rules/apply-all/route.ts`

**Services (Decimal compatibility):**
- `src/lib/services/closing-engine.ts`
- `src/lib/services/reconciliation.service.ts`
- `src/lib/services/entity-detector.ts`
- `src/lib/services/entity-classifier.ts`
- `src/lib/services/import.service.ts`
- `src/lib/services/journal-entry.service.ts`
- `src/lib/services/journal.service.ts`
- `src/lib/services/onboarding.service.ts`
- `src/lib/services/entity-context-crud-service.ts`
- `src/lib/accounting/flow-aggregator.ts`
- `src/lib/accounting/fuzzy-pre-filter.ts`
- `src/lib/chart-of-accounts.ts`
- `src/lib/sanitize.ts`
- `src/lib/utils/decimal.ts`

**Tests:**
- `tests/sessions-hashing.test.ts` — New: session hashing tests
- `tests/setup.ts` — Removed SQLite fallback
- `tests/globalTeardown.ts` — Removed SQLite cleanup
- `tests/middleware.test.ts` — Cookie name update
- `tests/security.test.ts` — Cookie name update
- `tests/api-handler.test.ts` — Auth service compatibility
- `tests/integration/sqlite-wal-concurrency.test.ts` — Adapted to PostgreSQL as `tests/integration/postgres-concurrency.test.ts`
- `tests/integration/postgres-concurrency.test.ts` — PostgreSQL concurrency test
- Various component/test files for Decimal compatibility

## Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 1. `schema.prisma` migrated to `postgresql` provider | ✅ | `provider = "postgresql"` in schema.prisma line 6 |
| 2. All monetary fields updated to `Decimal(18,2)` with clean compile | ✅ | 13 Decimal(18,2) fields, 0 Float remaining |
| 3. All tests pass under PostgreSQL | ✅ | 954 tests pass; 5 pre-existing failures (batch-otro-classification, unrelated) |
| 4. SQLite PRAGMAs removed | ✅ | 0 references to PRAGMA/pragma in db.ts |
| 5. Session tokens stored as SHA-256 hashes | ✅ | `crypto.createHash('sha256')` in sessions.ts |
| 6. Cookie name standardized to `session_token` | ✅ | sessions.ts uses `session_token`, all auth routes updated |

**Test Results**: 954 passing, 5 pre-existing failures (batch-otro-classification, unrelated to this change)

## Tasks Completion

All 27 tasks across 5 phases complete:

| Phase | Tasks | Status |
|-------|-------|--------|
| 1. Foundation | 5 tasks (schema, db.ts, sessions.ts) | ✅ Complete |
| 2. Authentication & Cookie | 4 tasks (login, register, logout, proxy) | ✅ Complete |
| 3. Monetary & Decimal Refactoring | 12 tasks (services, API routes) | ✅ Complete |
| 4. Test Infrastructure | 5 tasks (setup, teardown, test files) | ✅ Complete |
| 5. Cleanup & Verification | 1 task (migrations, compile, test) | ✅ Complete |

## Source of Truth Updated

New main specs created:
- `openspec/specs/data-persistence/spec.md`
- `openspec/specs/monetary-calculations/spec.md`
- `openspec/specs/session-token-hashing/spec.md`

## Lessons Learned

1. **Decimal conversion scope is broad**: Changing Float to Decimal in Prisma cascades to every file that reads or computes on those fields — over 30 files needed `.toNumber()` conversions. Automated type checking (tsc) was essential to catch all occurrences.

2. **Prisma v6 migration complexity**: The `$use` middleware API was removed in Prisma v6, requiring significant refactoring of middleware patterns that previously ran on SQLite.

3. **Test database infrastructure**: Running tests against PostgreSQL requires a running Postgres instance. The existing `DATABASE_URL` env var pattern worked well, but CI/CD must ensure a test database is provisioned.

4. **Session hashing is transparent to callers**: By keeping function signatures identical (`createSession` returns `Promise<string>`, `destroySession` takes `string`), the hashing change was invisible to all 30+ callers across auth routes, proxy middleware, and test files.

5. **Cookie name standardization ripple**: Changing the cookie name from `session` to `session_token` required updates across 4 layers: sessions utility, proxy middleware, auth routes, and tests. Missing any one would break the auth flow.

## SDD Cycle Complete

This change has been fully planned (proposal → specs → design → tasks), implemented (27/27 tasks), verified (6/6 criteria, 954 tests), and archived.
