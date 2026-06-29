# Tasks: Safe Apply All

> **Change**: safe-apply-all
> Atomicity, batch cap, and preview for `/api/bank-rules/apply-all`.

---

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Total tasks | 14 |
| New files | 3 (`apply-all-engine.ts`, `preview/route.ts`, `tests/api/bank-rules/apply-all.test.ts`) |
| Modified files | 3 (`route.ts`, potentially `tests/services/apply-all-engine.test.ts`) |
| Estimated changed lines | ~350–450 |
| Review risk | **Medium** — most changes are structural extraction with high test coverage; atomic transaction logic requires careful review |
| Chained PRs recommended | No — single change, self-contained |
| Testing coverage | 3 spec files: 15+ test cases covering atomicity, batch cap, preview, and edge cases |
| Decision needed before apply | No — design and specs fully cover the approach |

---

## Phase 1 — `apply-all-engine.ts` (new)

> Shared service extracting read-only matching + mutation logic from `route.ts`.

- [x] ### Task 1.1: Create `matchTransactions()` function

**File**: `src/lib/services/apply-all-engine.ts`

**Description**: Extract the read-only matching logic from `route.ts` lines 28–123 into a pure function.

**Spec refs**: REQ-ATOMIC-01 (matching outside tx), REQ-PREVIEW-01 (shared matching), Design data flow

**Implementation steps**:

1. Load entity-first context via `loadEntityFirstContext(companyId)`
2. Fetch active rules sorted by priority: `db.bankRule.findMany({ where: { companyId, isActive: true }, orderBy: { priority: 'asc' } })`
3. Fetch company's `maxApplyTransactions` cap
4. Compute `effectiveCap = Math.min(company?.maxApplyTransactions ?? MAX_PER_BATCH, MAX_PER_BATCH)`
5. Fetch unmatched transactions: `db.bankTransaction.findMany({ where: { statementId: { in: statementIds }, isReconciled: false, matchedRuleId: null } })`
6. Truncate to `effectiveCap`
7. Compute `remaining = totalUnmatched - effectiveCap` (if truncated, else 0)
8. Run the rule matching loop (current lines 98–123): `transactionMatchesRule` → `evaluateWinningRule` → `winnerMap`
9. Compute `totalAmount` from matched transactions
10. Return `MatchResult` with `matchedRules`, `transactions`, `totalAmount`, `totalCount`, `remaining`

**Exports**: `matchTransactions(companyId: string, options?: MatchOptions): Promise<MatchResult>`

**Imports**: same as route.ts: `db`, `loadEntityFirstContext`, `transactionMatchesRule`, `evaluateWinningRule`, `loadRolePriorities`, etc.

**Risk**: low — pure extraction, no behavioral change.

---

- [x] ### Task 1.2: Create `executeApplyAll()` function

**File**: `src/lib/services/apply-all-engine.ts`

**Description**: Extract all mutation logic into a function that takes a Prisma transaction client `tx`.

**Spec refs**: REQ-ATOMIC-01, REQ-ATOMIC-04 (lock ordering), Design transaction flow

**Input signature**:
```typescript
interface ApplyResult {
  appliedCount: number;
  journalEntryCount: number;
}

function executeApplyAll(
  companyId: string,
  tx: Prisma.TransactionClient,
  matchResult: MatchResult,
): Promise<ApplyResult>;
```

**Implementation steps**:
1. Iterate `matchResult.matchedRules`
2. For each rule:
   a. Split `txIds` into `debitIds` (amount < 0) and `creditIds` (amount >= 0)
   b. Sort both arrays ascending
   c. `tx.bankTransaction.updateMany({ where: { id: { in: debitIds } }, data: { glAccountId, matchedRuleId } })`
   d. `tx.bankTransaction.updateMany({ where: { id: { in: creditIds } }, data: { glAccountId, matchedRuleId } })`
3. Re-fetch all matched transactions: `tx.bankTransaction.findMany({ where: { id: { in: allMatchedIds } }, select: { id, date, amount, description, glAccountId, statementId } })`
4. Load statement → bankAccount → bankGL mapping (using `tx` client to stay inside transaction)
5. For each re-fetched transaction: `JournalEntryService.createFromBankTransaction(tx, { ... })`
6. Return `{ appliedCount, journalEntryCount }`

**Deadlock mitigation**:
- Debits processed first per rule, credits second (consistent lock order)
- IDs sorted ascending within each group (prevents lock ordering inversion)

**Exports**: `executeApplyAll(companyId: string, tx: Prisma.TransactionClient, matchResult: MatchResult): Promise<ApplyResult>`

**Risk**: medium — the re-fetch + bank GL lookup chain must use `tx` throughout, not `db`. Verify `JournalEntryService.createFromBankTransaction` accepts `tx` as first param (confirmed by existing usage and signature).

---

## Phase 2 — POST endpoint refactor (atomic transaction)

> Refactor `route.ts` to use the engine, wrapping ALL mutations inside `db.$transaction`.

- [x] ### Task 2.1: Replace inline matching with `matchTransactions()` call

**File**: `src/app/api/bank-rules/apply-all/route.ts`

**Description**: Replace lines 28–123 (rule loading, cap logic, matching loop) with a single `matchTransactions()` call.

**Changes**:
1. Import `{ matchTransactions, executeApplyAll }` from `@/lib/services/apply-all-engine`
2. Remove imports for `loadEntityFirstContext`, `transactionMatchesRule`, `evaluateWinningRole`, `loadRolePriorities` (moved to engine)
3. Replace lines 28–123 with:
```typescript
const matchResult = await matchTransactions(companyId, { limit: 200 });
```
4. Keep lines 1–27 (imports, handler, `requireCompanyContext`)
5. If `matchResult.matchedRules.length === 0`, return early response (same as current `rules.length === 0` check)

**Spec refs**: REQ-ATOMIC-01

**Risk**: low — mechanical extraction.

---

- [x] ### Task 2.2: Wrap all mutations in `db.$transaction`

**File**: `src/app/api/bank-rules/apply-all/route.ts`

**Description**: Move `executeApplyAll()` inside `db.$transaction()` — this is the atomicity fix.

**Changes**:
1. After `matchResult`, call:
```typescript
const applyResult = await db.$transaction(async (tx) => {
  return executeApplyAll(companyId, tx, matchResult);
});
```
2. Remove lines 126–199 (the old mutation code including inline `updateMany`, re-fetch, statement loading, and the existing `$transaction` block)

**Spec refs**: REQ-ATOMIC-01, REQ-ATOMIC-02, REQ-ATOMIC-03

**Risk**: high — this is the core atomicity change. If `executeApplyAll()` uses `db` instead of `tx` anywhere inside the transaction, the fix is broken. Must verify every `db.` call inside `executeApplyAll` uses the `tx` parameter.

---

- [x] ### Task 2.3: Update POST response structure

**File**: `src/app/api/bank-rules/apply-all/route.ts`

**Description**: Add `remaining` and `warning` to the POST response. Preserve backward compatibility.

**Changes**:
1. Add `remaining` to response (from `matchResult.remaining`)
2. Add `warning` when `matchResult.remaining > 0` (truncation warning, i18n via `serverT`)
3. Keep existing fields: `success`, `matched`, `total`, `rulesApplied`

**Response shape**:
```typescript
{
  success: true,
  matched: applyResult.appliedCount,
  total: matchResult.totalCount,
  remaining: matchResult.remaining,
  warning?: string,  // i18n warning if truncated
  rulesApplied: Array<{ ruleId: string; ruleName: string; count: number }>,
}
```

**Spec refs**: REQ-BATCH-02, REQ-BATCH-05

**Risk**: low — additive fields, existing clients ignore unknown fields.

---

## Phase 3 — Preview endpoint (new)

> Read-only GET endpoint that returns estimated batch totals.

- [x] ### Task 3.1: Create preview route handler

**File**: `src/app/api/bank-rules/apply-all/preview/route.ts` (new)

**Description**: GET handler that calls `matchTransactions()` and returns estimated totals.

**Implementation**:
```typescript
import { NextResponse } from 'next/server';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { matchTransactions } from '@/lib/services/apply-all-engine';

export const GET = apiHandler(async (request, context) => {
  const { companyId } = requireCompanyContext();

  const result = await matchTransactions(companyId, { limit: 200 });

  return NextResponse.json({
    totalTransactions: result.totalCount,
    totalAmount: result.totalAmount,
    rulesToApply: result.matchedRules.length,
    remaining: result.remaining,
    warning: result.matchedRules.length === 0
      ? 'No active rules match pending transactions.'
      : null,
  });
});
```

**Spec refs**: REQ-PREVIEW-01 through REQ-PREVIEW-06

**Verification**: No `db.*.create`, `db.*.update`, `db.*.delete`, or `db.*.upsert` calls in the handler or its call chain.

**Risk**: low — pure read-only, no mutation path.

---

## Phase 4 — Batch cap enforcement

> Replace the hardcoded 5000 safety net with a capped 200 max per batch.

- [x] ### Task 4.1: Define `MAX_PER_BATCH` constant

**File**: `src/lib/services/apply-all-engine.ts`

**Description**: Add module-level constant replacing the old `MAX_SAFETY`.

**Change**: Replace implicit hardcoded safety with:
```typescript
const MAX_PER_BATCH = 200;
```

**Spec refs**: REQ-BATCH-01, REQ-BATCH-03

---

- [x] ### Task 4.2: Implement effective cap logic

**File**: `src/lib/services/apply-all-engine.ts` (inside `matchTransactions`)

**Description**: Compute effective cap as `MIN(company?.maxApplyTransactions ?? MAX_PER_BATCH, MAX_PER_BATCH)`.

**Logic**:
```typescript
const effectiveCap = company?.maxApplyTransactions
  ? Math.min(company.maxApplyTransactions, MAX_PER_BATCH)
  : MAX_PER_BATCH;
```

**Spec refs**: REQ-BATCH-04

---

- [x] ### Task 4.3: Retain early-return for 0 rules

**File**: `src/lib/services/apply-all-engine.ts` (inside `matchTransactions`)

**Description**: If no active rules exist, return empty `MatchResult` immediately (early exit before fetching transactions).

**Reason**: Performance optimization — don't query transactions if no rules can match them. Preserves existing behavior from route.ts line 35.

---

## Phase 5 — Tests (TDD: write tests first)

> Follow project test patterns (Vitest, factories from `tests/helpers/factories`).

- [x] ### Task 5.1: Unit tests for `matchTransactions()`

**File**: `tests/services/apply-all-engine.test.ts` (new)

**Description**: Pure function tests with mocked Prisma.

**Test cases**:
1. **No active rules** → empty result, early return
2. **Zero pending** → totalCount 0
3. **Over cap** — 300 pending → totalCount 200, remaining 100
4. **Total amount** — compute from matched transactions
5. **Custom limit** — respects company override of 30
6. **Company override above absolute cap** — 500 → capped at 200

**Spec refs**: BATCH-SC-01 through BATCH-SC-06

---

- [x] ### Task 5.2: Unit tests for `executeApplyAll()`

**File**: `tests/services/apply-all-engine.test.ts`

**Description**: Test the transaction function with a mock `tx` client.

**Test cases**:
1. **Debits before credits** — verify `updateMany` called with debit IDs first
2. **Sorted IDs within groups** — verify IDs are sorted ascending
3. **Journal entry creation count** — calls `createFromBankTransaction` per matched tx
4. **Re-fetch uses tx client** — verifies `tx.bankTransaction.findMany` is used

**Spec refs**: REQ-ATOMIC-04, Acceptance criteria 3 (lock order), Acceptance criteria 4 (re-fetch inside tx)

---

- [x] ### Task 5.3: Integration test — atomicity (happy path)

**File**: `tests/api/bank-rules/apply-all.test.ts` (new)

**Description**: Full integration test with real DB (using factories).

**Test cases**:
1. **ATOMIC-SC-01**: 5 unmatched transactions, 2 matching rules → POST returns `matched: 5`, `remaining: 0`, all transactions have `matchedRuleId` set
2. **ATOMIC-SC-04**: 0 pending → POST returns `matched: 0`, `total: 0`

**Spec refs**: ATOMIC-SC-01, ATOMIC-SC-04

**Setup**: Use `createTestUser`, `createTestCompany`, `createTestCompanyMember`, `createTestGlAccount`, `createTestBankStatement`, `createTestBankTransaction`, `createTestBankRule` from factories.

---

- [x] ### Task 5.4: Integration test — atomicity (rollback on failure)

**File**: `tests/api/bank-rules/apply-all.test.ts`

**Description**: Prove that a failure in journal creation rolls back ALL mutations.

**Test cases**:
1. **ATOMIC-SC-02**: 3 unmatched transactions, stub `createFromBankTransaction` to throw on 3rd call → POST returns 500, all 3 transactions have `matchedRuleId: null`
2. Verify: `SELECT COUNT(*) FROM bank_transaction WHERE matched_rule_id IS NOT NULL AND journal_entry_id IS NULL` returns 0

**Spec refs**: ATOMIC-SC-02, Acceptance criteria 1 (atomic rollback), Acceptance criteria 2 (no orphans)

---

- [x] ### Task 5.5: Integration test — concurrency

**File**: `tests/api/bank-rules/apply-all.test.ts`

**Description**: Two parallel POST requests with 200+ pending transactions.

**Test cases**:
1. **ATOMIC-SC-03**: 2 concurrent requests, 300 pending → combined matched = 200 (first request gets the batch, second finds 100 remaining), no deadlock

**Spec refs**: ATOMIC-SC-03

**Note**: Use `Promise.all` to fire both requests. Timeout: 10s. Use an isolation level/transaction timeout that matches production (5s statement timeout).

---

- [x] ### Task 5.6: Integration test — batch cap

**File**: `tests/api/bank-rules/apply-all.test.ts`

**Description**: Verify batch cap enforcement via integration.

**Test cases**:
1. **BATCH-SC-02**: 250 pending, no company override → `matched: 200`, `remaining: 50`, `warning` present
2. **BATCH-SC-05**: `maxApplyTransactions = 500`, 400 pending → `matched: 200` (capped at absolute max)
3. **BATCH-SC-03**: 5000 pending, no override → `matched: 200`, `remaining: 4800`
4. **Remaining accuracy**: After truncated batch, calling POST again processes next batch, `remaining` decreases

**Spec refs**: BATCH-SC-01 through BATCH-SC-06

---

- [x] ### Task 5.7: Integration test — preview endpoint

**File**: `tests/api/bank-rules/apply-all.test.ts`

**Description**: GET preview endpoint behavior.

**Test cases**:
1. **PREVIEW-SC-01**: 45 pending, 3 matching rules → `totalTransactions: 45`, `rulesToApply: 3`, zero DB writes
2. **PREVIEW-SC-02**: No active rules → `totalTransactions: 0`, `warning` present
3. **PREVIEW-SC-04**: 350 pending → `totalTransactions: 200`, `remaining: 150`
4. **PREVIEW-SC-05**: 0 pending → `totalTransactions: 0`, no warning
5. **Zero mutation**: Intercept Prisma client, assert no write operations called during preview

**Spec refs**: PREVIEW-SC-01 through PREVIEW-SC-05, Acceptance criteria 1 (zero mutation)

---

## Task Dependency Graph

```
Phase 1 (engine) ─┬─> Phase 2 (endpoint refactor) ──> Phase 5.3–5.6 (integration tests)
                   │
                   └─> Phase 3 (preview) ──> Phase 5.7 (preview tests)
                   │
                   └─> Phase 4 (batch cap) ──> Phase 5.1, 5.2 (unit tests)
```

**Execution order**: Phase 1 → (Phase 2 + Phase 3 + Phase 4 parallel) → Phase 5

---

## Files Summary

| # | File | Action | Est. Lines | Depends On |
|---|------|--------|------------|------------|
| 1 | `src/lib/services/apply-all-engine.ts` | Create | ~120 | — |
| 2 | `src/app/api/bank-rules/apply-all/route.ts` | Modify | ~60 (net reduction) | 1 |
| 3 | `src/app/api/bank-rules/apply-all/preview/route.ts` | Create | ~25 | 1 |
| 4 | `tests/services/apply-all-engine.test.ts` | Create | ~130 | 1, 4 |
| 5 | `tests/api/bank-rules/apply-all.test.ts` | Create | ~200 | 1, 2, 3, 4 |

## Total

- **Phases**: 5
- **Tasks**: 14
- **New files**: 4 (1 service + 1 route + 2 test files)
- **Modified files**: 1 (route.ts)
