## Exploration: postgres-migration-and-session-hashing

### Current State
* The codebase on `main` currently uses **SQLite** as its relational database provider (`provider = "sqlite"`).
* All numeric monetary fields (balances, amounts, debits, credits) are represented using the standard JS native `Float` type, which is prone to rounding errors in financial transactions.
* Database initialization in `src/lib/db.ts` runs SQLite-specific optimizations (`PRAGMA journal_mode=WAL;` and `PRAGMA synchronous=NORMAL;`), which will trigger runtime exceptions if run against PostgreSQL.
* Session tokens in `src/lib/sessions.ts` are stored as plaintext UUIDs in the database, posing a security risk if the database is compromised.
* New models (`EntityContext`, `SystemMemory`, `BankProfile`, `RateLimit`) exist on the `main` branch, but they are not present on the `master` branch. They currently run on SQLite and need database provider migration.

### Affected Areas
- `prisma/schema.prisma` — Needs database provider changed to `"postgresql"`. Converting monetary/numeric fields to `Decimal` with `@db.Decimal(18, 2)`. New models (`EntityContext`, `SystemMemory`, `BankProfile`, `RateLimit`) need to be integrated and verified for PostgreSQL compatibility.
- `src/lib/db.ts` — Remove SQLite-specific optimization PRAGMA statements and simplify PrismaClient initialization.
- `src/lib/sessions.ts` — Port the SHA-256 session token hashing implementation. The cookie name should be standardized to `session_token` rather than `session`.
- `src/app/api/auth/login/route.ts` & `src/app/api/auth/register/route.ts` — Update session cookie setting to use the new `session_token` cookie name and align with helper changes.
- **Multiple API Routes & Services** (e.g., `src/app/api/journal/route.ts`, `src/app/api/reconciliation/...`, `src/lib/journal-hash.ts`) — Changing `Float` to `Decimal` changes the TypeScript types returned by Prisma Client from `number` to `Decimal` (from `decimal.js`). Any math or comparison operations on these fields must be updated to use `.toNumber()` or decimal methods (e.g., `.plus()`, `.minus()`).
- **Tests** (e.g., `tests/services/auth.service.test.ts`, `tests/api-handler-multitenant.test.ts`) — Any test that invokes `createSession()` or depends on session creation must be updated to support the session token signature. The test setup also needs to support PostgreSQL instead of the local SQLite `test.db`.

### Approaches

1. **Approach 1: Strict Porting of Master's Implementations (High Alignment)**
   - Port all changes from `master` directly, including changing prisma provider to `postgresql` with `Decimal` fields and rewriting `src/lib/sessions.ts` with master's exact signatures (`createSession` returns `{ rawToken, sessionId }`, `destroySession` takes `NextRequest`). Refactor every single math operation and test calling `createSession` to match the new types.
   - **Pros**: Matches `master` exactly, aligning both branches and ensuring the same exact architecture.
   - **Cons**: High refactoring effort. Over 30 test files and 15+ controller files will require math conversion and session parameter updates.
   - **Effort**: High

2. **Approach 2: Postgres Migration with Signature-Preserved Session Hashing**
   - Change the database provider to `postgresql` with `Decimal` fields in `schema.prisma`. Port the SHA-256 session hashing logic into `src/lib/sessions.ts` but adapt the function signatures to remain backward-compatible (e.g., `createSession` still returns `Promise<string>` for the raw token, and `destroySession` accepts a token `string` instead of a request object). Refactor database float usages to `.toNumber()`.
   - **Pros**: Maintains the security improvements of token hashing without breaking any of the existing test suites or auth controllers that call `createSession(userId)` or `destroySession(token)`.
   - **Cons**: Diverges slightly from the signature used on `master`, requiring reconciliation if branches are merged in the future.
   - **Effort**: Medium

### Recommendation
We recommend **Approach 2 (Postgres Migration with Signature-Preserved Session Hashing)**. 
It delivers the exact same security (session hashing) and data integrity (PostgreSQL + Decimal types) benefits of master, but avoids massive test file churn by keeping the module boundary interfaces consistent. The new main models (`EntityContext`, `SystemMemory`, `BankProfile`, `RateLimit`) are naturally compatible with PostgreSQL as they contain no `Float` types.

### Risks
- **TypeScript Type Checks (Decimal vs number)**: Changing float fields to Decimal will cause compilation errors across any code performing math or comparison operators. This requires careful refactoring to use `.toNumber()` for comparison/display or decimal.js methods for arithmetic.
- **PostgreSQL Test Infrastructure**: Unlike SQLite which runs in-memory or in a local file, running tests with PostgreSQL requires a running Postgres instance. We must provision a test PostgreSQL database (e.g. via Docker Compose or a local Postgres service) and update the `DATABASE_URL` in the test environment.
- **Active Session Invalidation**: Hashing session tokens will render all active sessions in the database invalid since their plaintext tokens will fail the hash verification. Users will be logged out on deployment.

### Ready for Proposal
**Yes** — We have analyzed the differences between `main` and `master` and proposed a backward-compatible migration path that incorporates the new models on `main`. The orchestrator can proceed with proposing the change to the user.
