# Delta Spec: Data Persistence (Postgres Migration)

## MODIFIED Requirements

- **Database Provider**: The relational database datasource provider in `prisma/schema.prisma` is changed from SQLite (`"sqlite"`) to PostgreSQL (`"postgresql"`).
- **Prisma Client Initialization**: Remove SQLite-specific optimization PRAGMA statements (`PRAGMA journal_mode=WAL;` and `PRAGMA synchronous=NORMAL;`) from `src/lib/db.ts` to prevent runtime connection errors under PostgreSQL.
- **Model Support**: The relational tables for `EntityContext`, `SystemMemory`, `BankProfile`, and `RateLimit` are fully migrated to PostgreSQL, ensuring field structures are compatible with PostgreSQL.
- **Test Database Environment**: The test runner is configured to use a PostgreSQL database connection string via the `DATABASE_URL` environment variable instead of the default SQLite test database.

## REMOVED Requirements

- **SQLite Database Support**: SQLite database connection support and the default initialization of the local `test.db` file for test suites are removed.

## Scenarios

### Scenario 1: Prisma Client Connection to PostgreSQL Database
Given the application is configured to use PostgreSQL
When the database client is initialized via `src/lib/db.ts`
Then no SQLite-specific `PRAGMA` commands are executed
And a valid PostgreSQL connection to the database specified by `DATABASE_URL` is established

### Scenario 2: Test Suite Database Execution
Given a Vitest test suite is running
When a test performs database operations
Then the operations are executed against the PostgreSQL database configured via `DATABASE_URL`
