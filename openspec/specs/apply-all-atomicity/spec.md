# Spec: Apply All Atomicity

> **Change**: safe-apply-all | **Domain**: apply-all-atomicity
> Moves all mutations inside a single Prisma `$transaction` so that failure in any step rolls back everything.

---

## Requirements

| ID | Description | Priority |
|----|-------------|----------|
| REQ-ATOMIC-01 | All `bankTransaction.updateMany` calls (debit + credit) MUST occur inside the same Prisma `$transaction` block as `JournalEntryService.createFromBankTransaction` | P0 |
| REQ-ATOMIC-02 | If ANY bankTransaction update or journal entry creation fails, ALL mutations within the batch MUST be rolled back (no partial commit) | P0 |
| REQ-ATOMIC-03 | The HTTP response MUST indicate success only when ALL transactions in the batch were processed; partial success is NOT a valid state and MUST return a 500-level error | P0 |
| REQ-ATOMIC-04 | Within the transaction, debit transactions MUST be processed before credit transactions per rule group to maintain a consistent lock order and mitigate deadlock risk under concurrency | P2 |
| REQ-ATOMIC-05 | The `matchedTxIds` re-fetch (current lines 163-166) MUST be eliminated or moved inside the transaction — the re-fetch after `updateMany` can return stale data if another process modifies rows between the outer `updateMany` and the inner `createFromBankTransaction` | P1 |

---

## Scenarios

### Scenario ATOMIC-SC-01: Happy path — all succeed

**Given** 5 unmatched bank transactions that match 2 active rules
**When** the endpoint processes the batch
**Then** all 5 transactions have `matchedRuleId` and `glAccountId` set
**And** 5 journal entries are created (one per transaction)
**And** the response contains `success: true`, `matched: 5`
**And** no orphaned transactions exist with `matchedRuleId` set but no `journalEntryId`

### Scenario ATOMIC-SC-02: Partial failure — journal creation throws

**Given** 3 unmatched bank transactions, all matching rule R1
**When** `JournalEntryService.createFromBankTransaction` throws for the 3rd transaction
**Then** the Prisma `$transaction` rolls back ALL mutations
**And** all 3 transactions remain with `matchedRuleId: null` and `glAccountId: null`
**And** no journal entries exist for any of the 3 transactions
**And** the endpoint returns a 500 error (or throws, caught by error boundary)

### Scenario ATOMIC-SC-03: Concurrency — two parallel apply-all requests

**Given** 200 pending transactions and two concurrent POST requests
**When** both requests process the same batch window
**Then** the first request commits its transaction
**And** the second request finds 0 remaining pending transactions (or the ones the first request didn't process)
**And** no deadlock timeout occurs (lock acquisition succeeds within the 5s statement timeout)

### Scenario ATOMIC-SC-04: Empty batch — no pending transactions

**Given** 0 unmatched bank transactions
**When** the endpoint is called
**Then** the response returns `matched: 0`, `total: 0`
**And** no `$transaction` block is entered
**And** no mutations occur

---

## Acceptance Criteria

1. **Atomic rollback verification**: Write an integration test that stubs `JournalEntryService.createFromBankTransaction` to throw on the Nth call, then asserts that zero `bankTransaction` rows have `matchedRuleId` set after the request completes.
2. **No orphaned matched transactions**: After any failed apply-all attempt, a query `SELECT COUNT(*) FROM bank_transaction WHERE matched_rule_id IS NOT NULL AND journal_entry_id IS NULL` MUST return 0.
3. **Lock order consistency**: The `updateMany` calls inside the transaction MUST process debit IDs before credit IDs for every rule group. Verify by inspecting the execution order in the transaction callback.
4. **Re-fetch inside transaction**: The `matchedTxs` re-fetch (to get `glAccountId` and `statementId` for journal creation) MUST happen inside the `$transaction` block, using the transaction client `tx`, not `db`. Verify that no `db.bankTransaction.findMany` occurs between the outer update and the inner create.

---

## Implementation Notes

- `JournalEntryService.createFromBankTransaction` already accepts `(tx, data)` — the first parameter is the Prisma transaction client. No signature change needed.
- The current code structure splits work into three phases: (1) rule matching loop, (2) `updateMany` outside tx, (3) re-fetch + journal creation inside tx. Phase 2 must be moved inside the tx from phase 3.
- The rule matching loop (lines 98-123) is read-only and does NOT need to be inside the transaction. Only mutations (updateMany + journal creation) need the transaction.
- Consider using `tx.bankTransaction.updateMany` with the same `where`/`data` shape — Prisma's transaction client exposes the same API as `db`.
- The `matchedTxs` re-fetch should use `tx.bankTransaction.findMany` inside the transaction with the `matchedTxIds` collected from the outer loop.
