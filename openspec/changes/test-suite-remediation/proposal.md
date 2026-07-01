# Proposal: Test Suite Remediation

This proposal outlines the technical plan for resolving the 8 failing tests across 6 test files in the Account Express New Gen test suite. The plan maintains a strict boundary between test-only adjustments (such as alignment with existing implementations and mocking) and necessary fixes in the application code where bugs or serialization mismatches are present.

---

## 1. Categorization of Proposed Changes

### Category A: Test-Only Mocks & Assertions (Alignment)
These changes fix test runner environment issues and align tests with the actual application code behavior without modifying application logic.

1. **Rate Limiter Mock Alignment** (`tests/rate-limiter.test.ts` & `tests/security.test.ts`)
   - **Problem**: When importing `RateLimiter`, it instantiates the global `authRateLimiter` which calls `_loadFromDb` calling `db.rateLimit.findMany()`. Both test files define mocks for `@/lib/db` but lack `findMany` on the `rateLimit` mock object, causing a `TypeError`.
   - **Fix**: Add a mocked `findMany` returning `[]` to the `rateLimit` mock block in both files.

2. **Session Cookie Name Alignment** (`tests/sessions-hashing.test.ts`)
   - **Problem**: The tests expect the session cookie name to be standardized to `'session_token'`, whereas the codebase uses `'session'` in development and `'__Host-session'` in production. Under Vitest, `getSessionToken` searches for `'session'` and returns `null` because the test supplies `'session_token'`.
   - **Fix**: Propose test-only updates to rename the mocked headers/cookies in `tests/sessions-hashing.test.ts` to `'session'` to align with the active application implementation.

### Category B: Application Logic & Type/Payload Mismatches
These changes are targeted at the application files to address bugs, missing checks, or serialization issues.

3. **Reconciliation Book Balance Decimal Cast** (`src/app/api/reconciliation/route.ts`)
   - **Problem**: The `bookBalance` value is returned in the API payload as a `Prisma.Decimal` object, which Next.js serializes as a string (`"8000"`). The tests assert that the value is a number (`8000`).
   - **Fix**: Cast `bookBalance` to a JavaScript number using `bookBalance.toNumber()` before sending it in the JSON response payload. For robustness, `statementBalance` will also be cast to a number via `Number(statementBalance)`.

4. **Validate Request JSON Error Handling** (`src/lib/validate-request.ts`)
   - **Problem**: On endpoints registered to skip validation (like `/api/auth/logout`), the request body extraction swallows JSON parsing errors and returns `{}` instead of returning a 400 Bad Request `NextResponse` when the JSON is malformed.
   - **Fix**: Refactor `validateRequest` so that skip paths read the body as raw text first. If the text is empty/whitespace, it returns `{}`. If it contains data but fails JSON parsing, it returns the 400 Bad Request response.

5. **Duplicate Statement Import Validation** (`src/lib/services/import.service.ts`)
   - **Problem**: If a duplicate statement is imported, all transactions are duplicates, leading to `uniqueTransactions.length === 0`. The method immediately returns success with an empty statement ID, bypassing the subsequent database transaction block where the duplicate statement existence check is executed.
   - **Fix**: Run the duplicate statement existence check against the database before checking if `uniqueTransactions.length === 0`. Throw a `ConflictError` if the statement already exists for the given period.

---

## 2. Scoped Files to Modify

| File Path | Type | Rationale |
| :--- | :--- | :--- |
| `tests/rate-limiter.test.ts` | Test | Add `findMany` mock to `db.rateLimit` |
| `tests/security.test.ts` | Test | Add `findMany` mock to `db.rateLimit` |
| `tests/sessions-hashing.test.ts` | Test | Update cookie name from `'session_token'` to `'session'` in mock headers and assertions |
| `src/app/api/reconciliation/route.ts` | Source | Cast `bookBalance` to number via `.toNumber()` and `statementBalance` via `Number()` |
| `src/lib/validate-request.ts` | Source | Parse raw request text on skip paths to distinguish between empty body and malformed JSON |
| `src/lib/services/import.service.ts` | Source | Perform duplicate statement existence check before returning early on empty unique transactions |

---

## 3. Order of Fixes

The fixes should be applied in an order that builds confidence from infrastructure/mocks up to application logic:
1. **Mock Infrastructure Fixes** (`tests/rate-limiter.test.ts` & `tests/security.test.ts`)
2. **Session Cookie Mocks** (`tests/sessions-hashing.test.ts`)
3. **Decimal Type Casting** (`src/app/api/reconciliation/route.ts`)
4. **Skip-Path JSON handling** (`src/lib/validate-request.ts`)
5. **Duplicate statement import checks** (`src/lib/services/import.service.ts`)
