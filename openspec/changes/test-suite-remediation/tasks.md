# Tasks: Test Suite Remediation

This file lists the exact sequence of implementation tasks and verification commands required to resolve the 8 failing tests.

---

## 1. Task Breakdown

### Phase 1: Test-Only Mocks & Assertions (Mocks & Cookies)

- [x] **Task 1.1: Fix rate limiter test mock**
  - **Action**: Add `findMany: vi.fn().mockResolvedValue([])` to the `@/lib/db` mock in `tests/rate-limiter.test.ts`.
  - **Verification**: `npx vitest run tests/rate-limiter.test.ts`

- [x] **Task 1.2: Fix security test rate-limiter mock**
  - **Action**: Add `findMany: vi.fn().mockResolvedValue([])` to the `rateLimit` mock object inside `@/lib/db` mock in `tests/security.test.ts`.
  - **Verification**: `npx vitest run tests/security.test.ts`

- [x] **Task 1.3: Align session hashing cookie name assertions**
  - **Action**: Rename `session_token` to `session` in all mock request headers, cookies, and assertions in `tests/sessions-hashing.test.ts`.
  - **Verification**: `npx vitest run tests/sessions-hashing.test.ts`

### Phase 2: Application Logic Fixes

- [x] **Task 2.1: Cast Decimal values in reconciliation API**
  - **Action**: Convert `bookBalance` to a number using `.toNumber()` and `statementBalance` using `Number()` in the response payload of `src/app/api/reconciliation/route.ts`.
  - **Verification**: `npx vitest run tests/api/reconciliation-book-balance.test.ts`

- [x] **Task 2.2: Handle malformed JSON body on validation skip paths**
  - **Action**: In `src/lib/validate-request.ts`, retrieve request text using `req.text()`. Check if it is empty/whitespace (return `{}`) or if it contains data but is malformed (throw error resulting in 400 response).
  - **Verification**: `npx vitest run tests/validate-request.test.ts`

- [x] **Task 2.3: Prevent duplicate bank statement re-imports**
  - **Action**: In `src/lib/services/import.service.ts`, perform the duplicate statement existence query `db.bankStatement.findFirst` before checking if `uniqueTransactions.length === 0`. Throw `ConflictError` if the statement exists.
  - **Verification**: `npx vitest run tests/services/import.service.test.ts`

---

## 2. Global Verification

Once all individual tasks are completed, run the entire suite of 6 target files to verify 100% success rate:

```bash
npx vitest run tests/rate-limiter.test.ts tests/security.test.ts tests/sessions-hashing.test.ts tests/validate-request.test.ts tests/api/reconciliation-book-balance.test.ts tests/services/import.service.test.ts
```
