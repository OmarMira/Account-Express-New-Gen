# Delta for Zero-Amount Transaction Filtering

## ADDED Requirements

### Requirement: REQ-ZERO-01 — `clusterExact()` skips zero-amount transactions

The system MUST skip transactions where `Math.abs(Number(amount)) < 0.00001` inside `clusterExact()`. Skipped transactions MUST NOT participate in clustering. They MUST still appear in the transaction list.

#### Scenario: Zero-amount string excluded from exact clustering

- GIVEN a transaction with `amount: "0.00"`
- WHEN `clusterExact` processes the transaction set
- THEN the zero-amount transaction MUST NOT appear in any cluster

#### Scenario: Numeric zero excluded

- GIVEN a transaction with `amount: 0`
- WHEN `clusterExact` is called
- THEN the transaction MUST be skipped for clustering

#### Scenario: Very small amount just below epsilon excluded

- GIVEN a transaction with `amount: 0.000001`
- WHEN `clusterExact` is called
- THEN the transaction MUST be skipped (`Math.abs(Number("0.000001"))` = `0.000001` < `0.00001`)

#### Scenario: Small but non-zero amount included

- GIVEN a transaction with `amount: 0.01`
- WHEN `clusterExact` is called
- THEN the transaction MUST participate in clusters (`0.01 >= 0.00001`)

### Requirement: REQ-ZERO-02 — `clusterFuzzy()` skips zero-amount transactions

The system MUST apply the identical `Math.abs(Number(amount)) < 0.00001` guard inside `clusterFuzzy()`.

#### Scenario: Zero-amount excluded from fuzzy clustering

- GIVEN a transaction with `amount: "0.00"`
- WHEN `clusterFuzzy` is called
- THEN the transaction MUST NOT appear in any fuzzy cluster
- AND the cluster count MUST match the non-zero-only count

### Requirement: REQ-ZERO-03 — `computeDirectionProfile()` skips zero-amount transactions

The system MUST skip zero-amount transactions when computing `DirectionProfile`. Zero-amount transactions MUST NOT be counted toward `debitPct` or `creditPct`.

#### Scenario: Zero-amount not counted in direction profile

- GIVEN 10 debit transactions, 10 credit transactions, and 5 zero-amount transactions
- WHEN `computeDirectionProfile` is called
- THEN `debitPct` MUST be `0.50` and `creditPct` MUST be `0.50` (20 non-zero transactions)
- AND the 5 zero-amount transactions are excluded from the computation

### Requirement: REQ-ZERO-04 — Zero-amount transactions still visible

Zero-amount transactions MUST NOT be removed from any list view. The filter applies ONLY to clustering and direction-profile computation.

#### Scenario: Zero-amount appears in transaction list

- GIVEN a transaction list with 3 items, one having `amount: "0.00"`
- WHEN a user views the transaction list
- THEN all 3 transactions MUST be displayed
- AND no visual indicator suggests the zero-amount entry was filtered
