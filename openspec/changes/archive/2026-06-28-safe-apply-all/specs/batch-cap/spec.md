# Spec: Batch Cap

> **Change**: safe-apply-all | **Domain**: batch-cap
> Reduces the hardcoded safety cap from 5000 to 200 and adds `remaining` count to the response for UI pagination.

---

## Requirements

| ID | Description | Priority |
|----|-------------|----------|
| REQ-BATCH-01 | The server MUST reject (or truncate to) processing more than **200** transactions in a single POST request | P0 |
| REQ-BATCH-02 | The response MUST include a `remaining: number` field indicating how many unmatched transactions still await processing after this batch | P0 |
| REQ-BATCH-03 | The hardcoded fallback when `company.maxApplyTransactions` is NULL MUST be **200** (replacing the current `MAX_SAFETY = 5000`) | P0 |
| REQ-BATCH-04 | The company-specific `maxApplyTransactions` value from the database is respected, but MUST be capped at an absolute maximum of 200 — a company override of e.g. 500 is treated as 200 | P0 |
| REQ-BATCH-05 | The response MUST include a `warning` message (i18n) when the batch is truncated, containing the applied count, total count, and remaining count | P1 |

---

## Scenarios

### Scenario BATCH-SC-01: Under the cap — all fit

**Given** 50 pending unmatched transactions
**When** POST is called
**Then** all 50 transactions are processed
**And** the response contains `matched: 50`, `total: 50`, `remaining: 0`
**And** no `warning` field is present

### Scenario BATCH-SC-02: Over the cap — truncated

**Given** 250 pending unmatched transactions, no company override (`maxApplyTransactions` is NULL)
**When** POST is called
**Then** exactly 200 transactions are processed
**And** the response contains `matched: 200`, `total: 250`, `remaining: 50`
**And** the `warning` field explains the truncation

### Scenario BATCH-SC-03: No company override, very large backlog

**Given** 5000 pending unmatched transactions, no company override
**When** POST is called
**Then** exactly 200 transactions are processed
**And** the response contains `matched: 200`, `total: 5000`, `remaining: 4800`
**And** the warning references 200 applied out of 5000

### Scenario BATCH-SC-04: Company override below cap

**Given** 150 pending transactions, company `maxApplyTransactions = 100`
**When** POST is called
**Then** exactly 100 transactions are processed
**And** the response contains `matched: 100`, `remaining: 50`

### Scenario BATCH-SC-05: Company override above absolute cap

**Given** 400 pending transactions, company `maxApplyTransactions = 500`
**When** POST is called
**Then** exactly 200 transactions are processed (capped at absolute max)
**And** the response contains `matched: 200`, `remaining: 200`

### Scenario BATCH-SC-06: Zero pending

**Given** 0 pending unmatched transactions
**When** POST is called
**Then** the response contains `matched: 0`, `total: 0`, `remaining: 0`
**And** no warning is present

---

## Acceptance Criteria

1. **Cap enforcement**: Regardless of company override value, no single POST request ever processes more than 200 transactions. Verified by passing a company override of 9999 and 5000 pending transactions — only 200 are processed.
2. **Remaining accuracy**: After a truncated batch, calling POST again immediately processes the next batch window, and `remaining` decreases accordingly.
3. **Warning presence**: The `warning` field is present iff `matched < total`. Verified for BATCH-SC-02, BATCH-SC-03, BATCH-SC-04, BATCH-SC-05. Absent for BATCH-SC-01 and BATCH-SC-06.
4. **No regression**: Company override of `null` no longer means "unlimited" — it falls back to 200, never to 5000.
5. **i18n**: The warning message respects the `x-locale` header (same as existing apply-all behavior).

---

## Implementation Notes

- Replace `const MAX_SAFETY = 5000` with `const MAX_PER_BATCH = 200` at module level.
- The cap logic chain: `effectiveCap = Math.min(company?.maxApplyTransactions ?? MAX_PER_BATCH, MAX_PER_BATCH)`.
- Compute `remaining = totalUnmatched - matched` after the cap is applied. This is the count of transactions NOT in this batch, NOT the count of remaining after this batch in the DB.
- The frontend uses `remaining` to decide whether to show a "Apply next batch" button.
- The current code uses `unmatchedTransactions.length = maxApplyCap` to truncate the array in place. This pattern is preserved but the cap value changes.
