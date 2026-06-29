# Design: Safe Apply All

## Technical Approach

Extract the read-only rule-matching logic into a shared `apply-all-engine.ts` module, then restructure the POST handler so ALL mutations (updateMany + journal creation) execute inside a single Prisma `$transaction`. Add a read-only preview GET endpoint that calls the same engine.

This maps to the proposal's 4-point approach: atomic transaction, ordered operations, batch cap, preview endpoint.

---

## Architecture Decisions

| Option | Tradeoffs | Decision |
|--------|-----------|----------|
| Extract matching into shared function vs inline-duplicate | Duplication drifts; extracted engine keeps preview and POST consistent | **Extract**: `apply-all-engine.ts` with `matchTransactions()` + `executeApplyAll()` |
| Single `$transaction` vs two-phase commit | 2PC adds infrastructure complexity; Prisma nested `$transaction` is already available | **Single `$transaction`** with `tx.bankTransaction.updateMany` |
| Debits-first lock ordering vs random order | Inconsistent order risks deadlock under concurrency | **Debits-then-credits**, IDs sorted ascending within each group |
| Hard cap (200) vs dynamic from company | Company cap must be bounded to prevent runaway batches | **`MIN(company.maxApplyTransactions ?? 200, 200)`** — absolute ceiling at 200 |
| Preview as separate file vs merged route handler | Separate file respects file-per-route Next.js convention; avoids conditional logic in POST handler | **New file** `preview/route.ts` |

---

## Data Flow

```
     ┌──────────────────────────────────────────────────┐
     │              POST /api/bank-rules/apply-all      │
     │                                                  │
GET  │  1. matchTransactions(companyId, { limit })       │
preview│     → matchedRules, transactions, totals         │
     │  2. db.$transaction(async (tx) => {              │
     │     a. tx.bankTransaction.updateMany(debits)     │
     │     b. tx.bankTransaction.updateMany(credits)    │
     │     c. tx.bankTransaction.findMany(byIds)        │
     │     d. JournalEntryService.createFromBank...()   │
     │   })                                             │
     └──────┬───────────────────────────────────────────┘
            │
     ┌──────▼───────────────────────────────────────────┐
     │              GET /api/bank-rules/apply-all/preview│
     │  1. matchTransactions(companyId, { limit })       │
     │  2. Return { total, amount, rulesToApply, rem. } │
     │     No mutations                                  │
     └──────────────────────────────────────────────────┘
```

---

## Component Design

### `src/lib/services/apply-all-engine.ts` — NEW

```typescript
interface MatchResult {
  matchedRules: Array<{ rule: BankRule; txIds: string[] }>;
  transactions: BankTransaction[];
  totalAmount: number;
  totalCount: number;
  remaining: number;
}

interface ApplyResult {
  appliedCount: number;
  journalEntryCount: number;
}
```

Two exported functions:

- **`matchTransactions(companyId, options?)`** — pure read logic. Loads active rules, fetches unmatched transactions, computes effective cap, runs rule matching loop, returns `MatchResult`. No DB writes. Both preview and POST call this.

- **`executeApplyAll(companyId, tx, matchResult)`** — all mutations. Takes a Prisma transaction client `tx`, iterates rules from `matchResult`, processes debits-then-credits per rule, re-fetches matched transactions via `tx.bankTransaction.findMany`, creates journal entries. Returns `ApplyResult`.

### `src/app/api/bank-rules/apply-all/route.ts` — MODIFIED

Replace the current inline logic with:

1. `matchTransactions(companyId, { limit })` — replaces lines 47-123 inline code
2. If `matchedRules` is empty → return early response
3. `db.$transaction(async (tx) => { executeApplyAll(companyId, tx, matchResult) })`
4. Build response with `matched`, `total`, `remaining`, `warning`, `rulesApplied`

### `src/app/api/bank-rules/apply-all/preview/route.ts` — NEW

```typescript
export const GET = apiHandler(async (request, context) => {
  const { companyId } = requireCompanyContext();
  const result = await matchTransactions(companyId, { limit: 200 });
  return NextResponse.json({
    totalTransactions: result.totalCount,
    totalAmount: result.totalAmount,
    rulesToApply: result.matchedRules.length,
    remaining: result.remaining,
    warning: result.matchedRules.length === 0 ? 'No active rules match pending transactions.' : null,
  });
});
```

---

## Transaction Flow — Order of Operations

Inside `executeApplyAll()`:

```
for each (rule, txIds) in matchedRules:
  1. Split txIds into debitIds (amount < 0) and creditIds (amount >= 0)
  2. Sort both arrays ascending
  3. tx.bankTransaction.updateMany({ where: { id: { in: debitIds } } })
     → set matchedRuleId, glAccountId
  4. tx.bankTransaction.updateMany({ where: { id: { in: creditIds } } })
     → set matchedRuleId, glAccountId
  5. matchedTxIds.push(...debitIds, ...creditIds)

6. tx.bankTransaction.findMany({ where: { id: { in: matchedTxIds } } })
   → re-fetched transactions with tx client (not db)

7. For each re-fetched transaction:
   - JournalEntryService.createFromBankTransaction(tx, { ...data })
     → uses the same tx client for journal entry + ledger entries

If ANY step throws → entire $transaction rolls back → no partial state.
```

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/services/apply-all-engine.ts` | Create | `matchTransactions()` + `executeApplyAll()` — shared logic |
| `src/app/api/bank-rules/apply-all/route.ts` | Modify | Use engine, wrap all mutations in `$transaction` |
| `src/app/api/bank-rules/apply-all/preview/route.ts` | Create | GET handler, read-only, calls `matchTransactions()` |
| `tests/api/bank-rules/apply-all.test.ts` | Create | Integration tests for atomicity, batch cap, preview |

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `matchTransactions()` batching, cap logic | Pure function tests — mock Prisma, assert correct limit/remaining |
| Unit | `executeApplyAll()` lock ordering | Verify debitIds processed before creditIds per rule |
| Integration | Happy path — 5 txs, 2 rules | POST → assert 5 matched, 0 remaining |
| Integration | Partial failure — journal creation throws | Stub 3rd call to throw → assert 0 `matchedRuleId` set |
| Integration | Concurrency — 2 parallel POSTs, 200 txs | Assert no deadlock, correct split between requests |
| Integration | Batch cap — 250 txs, company override 500 | Assert exactly 200 processed, `remaining: 50` |
| Integration | Preview — 45 pending, 3 matching rules | GET preview → assert `totalTransactions: 45`, `rulesToApply: 3`, zero writes |
| Integration | Batch cap in preview — 350 pending | GET preview → assert `totalTransactions: 200`, `remaining: 150` |
| Integration | Empty scenario — 0 pending | POST → `matched: 0`; GET preview → `totalTransactions: 0` |

---

## Migration / Rollout

No migration required. The API contract changes are additive (`remaining`, `warning`) — existing clients continue to work.

**Rollback**: revert `route.ts` + delete `preview/route.ts` + delete `apply-all-engine.ts`.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Deadlock on concurrent apply-all | Low | Ordered debit-then-credit processing, sorted IDs |
| `JournalEntryService` doesn't propagate `tx` correctly | Low | Already accepts `tx as any` as first param — verify in tests |
| Preview briefly stale due to concurrent mutation | Low | Accepted per spec — preview is best-effort estimate |
| Large matchedTxIds array in memory (200 txs × fields) | Low | 200 records × ~200 bytes = ~40KB — negligible |

---

## Open Questions

- [ ] Verify `JournalEntryService.createFromBankTransaction` signature matches `(tx: PrismaTransactionClient, data: {...})` at the actual import — code review confirms but test coverage will validate.
- [ ] Confirm the `loadEntityFirstContext` call is safe outside the transaction (read-only, needed for matching phase).
