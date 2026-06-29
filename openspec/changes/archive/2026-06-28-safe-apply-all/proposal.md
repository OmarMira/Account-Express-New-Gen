# Proposal: Safe Apply All

## Intent

Fix a structural atomicity bug in `/api/bank-rules/apply-all` where `bankTransaction.updateMany` (lines 143–156) commits outside Prisma's `$transaction`, so journal creation failure (line 183+) leaves transactions marked as matched with no journal entries — ledger inconsistency.

## Scope

### In Scope
- Wrap ALL mutations inside a single `db.$transaction` (updateMany + journal creation)
- Reduce hardcoded `MAX_SAFETY` from 5000 to 200; respect company `maxApplyTransactions` but cap absolute max at 200
- Return `remaining` count in POST response so the UI can paginate batches
- Add `GET /api/bank-rules/apply-all/preview` returning estimated totals without mutation
- Mitigate deadlock risk via ordered debit-then-credit processing

### Out of Scope
- No UI changes (API contract only)
- No background jobs, queues, or workers
- No per-row selection in preview
- No changes to `JournalEntryService` internals
- No changes to `transaction-apply-limits` spec-level behavior (batch cap value changes, but the requirement pattern stays)

## Capabilities

### New Capabilities
- `apply-all-preview`: Preview endpoint returning pending transaction count, estimated totals, and batch metadata — zero mutation.

### Modified Capabilities
- `transaction-apply-limits`: Batch cap changed from "5000 safety net" to "200 absolute max with `remaining` in response". Company `maxApplyTransactions` overrides respected but capped at 200.

## Approach

1. **Atomic transaction**: Move the `updateMany` calls (143–156) inside the existing `db.$transaction` closure (183+). The Prisma `tx` client handles both `updateMany` and `JournalEntryService.createFromBankTransaction`. If any step fails, everything rolls back.
2. **Ordered operations**: Process debitIds first, then creditIds, in consistent order across calls to prevent deadlocks under concurrent apply-all requests.
3. **Batch cap**: Replace `MAX_SAFETY = 5000` with `const MAX_PER_BATCH = 200`. Cap `maxApplyTransactions` from company override to 200. Return `remaining: N` in the response when truncated.
4. **Preview endpoint**: `GET /api/bank-rules/apply-all/preview` — counts unmatched transactions, groups by bank, returns `{ total, perBank: [{ bankId, count, totalAmount }] }`. No DB writes. Accepts `cursor` for pagination if >200.
5. **JournalEntryService compatibility**: It already uses the Prisma `tx` client parameter (`tx as any`) — verify it propagates the parent transaction client correctly (likely needs `prisma: tx` option or direct `tx` passthrough; add if missing).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/api/bank-rules/apply-all/route.ts` | Modified | Atomic tx, batch cap, ordered operations, `remaining` in response |
| `src/app/api/bank-rules/apply-all/preview/route.ts` | New | Preview endpoint (GET, read-only) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Deadlock on concurrent apply-all | Low | Ordered debit-then-credit processing; single tx per request |
| `JournalEntryService` doesn't join parent tx | Low | Verify tx client passthrough; add `prisma: tx` option if missing |
| >200 txs still selected if no cap override | Low | Always apply `MAX_PER_BATCH = 200` regardless of company cap value |
| Preview briefly stale (concurrent mutation) | Low | Acceptable — preview is best-effort estimation; POST validates still-pending at write time |

## Rollback Plan

Revert `route.ts` to the previous version via git. Remove `preview/` directory. The existing `transaction-apply-limits` spec remains valid for the old behavior.

## Dependencies

- `JournalEntryService.createFromBankTransaction` must accept an optional Prisma tx client — verify before implementation.

## Success Criteria

- [ ] All mutation (updateMany + journal creation) executes inside a single `db.$transaction` — verified by test where journal creation throws and no `bankTransaction.matchedRuleId` is set
- [ ] Batch capped at 200 absolute max — 500 pending → 200 applied, `remaining: 300` returned
- [ ] `GET /preview` returns pending totals without any DB writes
- [ ] No deadlock warnings in logs under 10 concurrent requests with 200 txs each
