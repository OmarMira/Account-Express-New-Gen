# Transaction Apply Limits Specification

## Purpose

Configurable per-company transaction caps for the apply-all endpoint. Users MUST always know how many transactions were applied versus how many remain for manual review — no silent truncation is permitted.

## Requirements

### Requirement: Configurable Per-Company Cap

The `Company` model MUST include a `maxApplyTransactions` field (`Int?`, nullable). When `null`, the fallback is **200** (hardcoded, replacing the old 5000 safety net). When `0`, all auto-apply operations for that company MUST be blocked. The company-specific value is respected but MUST be capped at an absolute maximum of **200** — a company override of e.g. 500 is treated as 200.

#### Scenario: Cap of zero blocks all

- GIVEN company A has `maxApplyTransactions = 0`
- WHEN apply-all is called for company A
- THEN zero transactions MUST be auto-applied
- AND the response warning MUST indicate all require manual review

#### Scenario: Null cap falls back to 200

- GIVEN company A has `maxApplyTransactions = null`
- WHEN apply-all is called for company A with 300 pending transactions
- THEN exactly 200 transactions MUST be auto-applied
- AND the response MUST include `remaining: 100`
- AND the response MUST include a cap warning

#### Scenario: Company override above absolute cap is capped

- GIVEN company A has `maxApplyTransactions = 500`
- AND there are 400 pending transactions
- WHEN apply-all is called
- THEN exactly 200 transactions MUST be processed (capped at absolute max)
- AND the response contains `matched: 200`, `remaining: 200`

#### Scenario: Company override below absolute cap is respected

- GIVEN company A has `maxApplyTransactions = 100`
- AND there are 150 pending transactions
- WHEN apply-all is called
- THEN exactly 100 transactions MUST be processed
- AND the response contains `matched: 100`, `remaining: 50`

### Requirement: Cap Warning on Overflow

When the number of pending transactions exceeds the effective cap (company-specific or 200 fallback, whichever is lower), the apply-all endpoint MUST apply only up to the cap and return a warning payload. The warning text MUST use `t('bankRules.applyAll.capWarning')` with format: "Applied {applied} of {total} transactions. Remaining {remaining} require manual review."

#### Scenario: Cap exceeded with warning

- GIVEN company A has `maxApplyTransactions = 5`
- AND there are 12 pending transactions
- WHEN apply-all is called
- THEN exactly 5 transactions MUST be auto-applied
- AND the response MUST include a warning via `t('bankRules.applyAll.capWarning')` with `{applied: 5, total: 12, remaining: 7}`

#### Scenario: Cap exactly met

- GIVEN company A has `maxApplyTransactions = 10`
- AND there are exactly 10 pending transactions
- WHEN apply-all is called
- THEN all 10 MUST be auto-applied
- AND the response MUST NOT include a cap warning

#### Scenario: Remaining field tracks unconsumed backlog

- GIVEN 250 pending transactions with no company override
- WHEN POST is called
- THEN exactly 200 transactions are processed
- AND `remaining: 50` is returned
- AND calling POST again processes 50 and returns `remaining: 0`

#### Scenario: Absolute cap at 200 for very large backlog

- GIVEN 5000 pending transactions with no company override
- WHEN POST is called
- THEN exactly 200 transactions are processed
- AND `remaining: 4800` is returned

### Requirement: Remaining Field in Response

Every apply-all POST response MUST include a `remaining: number` field indicating how many unmatched transactions still await processing after this batch. The frontend uses this value to decide whether to show a "Apply next batch" button.

#### Scenario: Remaining present on all responses

- GIVEN any pending transactions
- WHEN POST is called
- THEN the response MUST include a `remaining` field (0 if none left, >0 if truncated)

### Requirement: Company-Specific Cap Capped at Absolute Maximum

The company-specific `maxApplyTransactions` value from the database is respected when below 200, but MUST be capped at an absolute maximum of **200**. This prevents a misconfigured company override from causing performance incidents.

#### Scenario: Cap enforcement regardless of override

- GIVEN a company override of 9999 and 5000 pending transactions
- WHEN POST is called
- THEN only 200 transactions are processed
- AND `remaining: 4800` is returned

### Requirement: No Silent Truncation

The system MUST NOT truncate results without signaling. If the cap is reached, the response body MUST include a `warning` field at the top level alongside applied results. The warning field MUST describe exactly how many were applied and how many remain.

#### Scenario: Warning presence is mandatory on overflow

- GIVEN a cap is configured and exceeded
- WHEN apply-all completes
- THEN the HTTP status MUST be `200 OK` (not a 4xx — partial success is valid)
- AND the response JSON MUST have a `warning` key with the locale message
- AND the `applied` count MUST reflect only the capped number

### Requirement: i18n for All Messages

All user-facing warning strings MUST use `t()` keys from `src/i18n/locales/{es,en}.ts`. Hardcoded warning text is forbidden.

#### Scenario: Translation key present in both locales

- GIVEN the key `bankRules.applyAll.capWarning` exists in both `es.ts` and `en.ts`
- WHEN the cap warning is triggered with the user's locale
- THEN the correct localized format string MUST be rendered
