# Spec: Apply All Preview

> **Change**: safe-apply-all | **Domain**: apply-all-preview
> Adds a read-only preview endpoint that returns estimated totals without mutating any data.

---

## Requirements

| ID | Description | Priority |
|----|-------------|----------|
| REQ-PREVIEW-01 | A `GET /api/bank-rules/apply-all/preview` endpoint MUST return estimated totals of pending transactions without mutating any data | P0 |
| REQ-PREVIEW-02 | Response MUST include `totalTransactions: number`, `totalAmount: number`, and `rulesToApply: number` (count of distinct active rules that match at least one pending transaction) | P0 |
| REQ-PREVIEW-03 | The endpoint MUST validate that referenced rules are still active and transactions are still pending — stale/inactive data from other processes is excluded from the estimate | P0 |
| REQ-PREVIEW-04 | The preview is an **estimate, not a lock** — the actual apply endpoint may process fewer transactions if state changes between preview and confirm | P1 |
| REQ-PREVIEW-05 | The preview endpoint MUST respect the same batch cap logic (200 max) — it returns estimated totals for the first batch only, matching what a single POST would process | P1 |
| REQ-PREVIEW-06 | The preview endpoint MUST return a `warning` field if all rules are deactivated or no transactions are pending | P2 |

---

## Scenarios

### Scenario PREVIEW-SC-01: Standard preview

**Given** 45 pending unmatched bank transactions
**And** 3 active rules that match at least one transaction each
**When** `GET /api/bank-rules/apply-all/preview` is called
**Then** the response contains `totalTransactions: 45`, `totalAmount: <sum of 45 amounts>`, `rulesToApply: 3`
**And** no database write operations occur

### Scenario PREVIEW-SC-02: No active rules

**Given** 200 pending unmatched bank transactions
**And** 0 active rules (all deactivated or deleted)
**When** `GET /api/bank-rules/apply-all/preview` is called
**Then** the response contains `totalTransactions: 0`, `totalAmount: 0`, `rulesToApply: 0`
**And** a `warning` field indicates no active rules exist

### Scenario PREVIEW-SC-03: All transactions already matched (concurrent mutation)

**Given** 5 pending transactions at preview start
**And** another process matches all 5 before the user confirms
**When** `GET /api/bank-rules/apply-all/preview` is called
**Then** the response shows `totalTransactions: 5` (the estimate at read time)
**And** the documentation explicitly states the estimate may differ from actual apply results

### Scenario PREVIEW-SC-04: Over the batch cap

**Given** 350 pending unmatched bank transactions
**And** 4 active rules
**When** `GET /api/bank-rules/apply-all/preview` is called
**Then** `totalTransactions: 200` (capped to what a single POST would process)
**And** `totalAmount: <sum of first 200>`
**And** `remaining: 150` is included in the response
**And** rulesToApply reflects rules matching within the first 200 transactions

### Scenario PREVIEW-SC-05: Preview with zero pending

**Given** 0 pending unmatched transactions
**When** `GET /api/bank-rules/apply-all/preview` is called
**Then** `totalTransactions: 0`, `totalAmount: 0`, `rulesToApply: 0`
**And** no warning is necessary (zero is not an error state)

---

## Acceptance Criteria

1. **Zero mutation**: The preview endpoint MUST NOT call any `db.*.create`, `db.*.update`, `db.*.upsert`, or `db.*.delete` method. Verify by intercepting the Prisma client and asserting no write operations are invoked during a preview call.
2. **Estimate correctness**: The preview counts are derived from the same query logic as the POST endpoint up to the cap boundary. For a snapshot period where no writes occur, preview and POST totals match exactly.
3. **Staleness acceptance**: The API contract explicitly documents that the preview is an estimate. A comment in the spec or code confirms the non-locking nature.
4. **Cap consistency**: The preview applies the same `MIN(company.maxApplyTransactions ?? 200, 200)` cap as the POST endpoint, so the preview totals reflect what the next POST would process.
5. **Response structure**: The preview response is a proper subset of the POST response fields — it uses `totalTransactions`, `totalAmount`, `rulesToApply`, `remaining`, and optionally `warning`. It does NOT include `matched` or per-rule breakdown (those only exist after actual processing).

---

## Implementation Notes

- Create `src/app/api/bank-rules/apply-all/preview/route.ts` with a `GET` handler.
- The preview reuses the same rule-matching logic as the POST handler, but stops before any mutation — it counts matched transactions and sums amounts.
- Consider extracting the matching logic into a shared `matchTransactions(rules, pendingTxs)` function used by both preview and POST to keep them consistent.
- The response format:
  ```json
  {
    "totalTransactions": 45,
    "totalAmount": 12345.67,
    "rulesToApply": 3,
    "remaining": 0,
    "warning": null
  }
  ```
- When `totalTransactions` is 0 and `rulesToApply` is 0, the `warning` field is set only when the cause is truly an edge case (e.g. no active rules). Zero pending with active rules is a normal state.
