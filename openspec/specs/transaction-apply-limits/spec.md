# Transaction Apply Limits Specification

## Purpose

Configurable per-company transaction caps for the apply-all endpoint. Users MUST always know how many transactions were applied versus how many remain for manual review — no silent truncation is permitted.

## Requirements

### Requirement: Configurable Per-Company Cap

The `Company` model MUST include a `maxApplyTransactions` field (`Int?`, nullable). When `null`, no cap is enforced (unlimited). When `0`, all auto-apply operations for that company MUST be blocked.

#### Scenario: Cap of zero blocks all

- GIVEN company A has `maxApplyTransactions = 0`
- WHEN apply-all is called for company A
- THEN zero transactions MUST be auto-applied
- AND the response warning MUST indicate all require manual review

#### Scenario: Null cap allows unlimited

- GIVEN company A has `maxApplyTransactions = null`
- WHEN apply-all is called for company A with 100 pending transactions
- THEN all 100 transactions MUST be auto-applied
- AND the response MUST NOT include a cap warning

### Requirement: Cap Warning on Overflow

When the number of pending transactions exceeds the company's `maxApplyTransactions`, the apply-all endpoint MUST apply only up to the cap and return a warning payload. The warning text MUST use `t('bankRules.applyAll.capWarning')` with format: "Applied {applied} of {total} transactions. Remaining {remaining} require manual review."

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
