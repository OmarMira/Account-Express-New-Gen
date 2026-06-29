# Domain 6: No Scoring Changes (Negative Spec)

## Overview

This is a negative specification — it explicitly defines what MUST NOT change. The deterministic matching engine (`rule-matching-engine.ts`) must remain untouched. No new scoring formulas, no new matching utilities, no new fields that affect matching priority. The existing priority (valid rule → priority → textual match → id ASC) is preserved.

## Requirements

| ID | Description | Priority |
|---|---|---|
| REQ-NO-01 | rule-matching-engine.ts MUST NOT receive any new scoring formulas | P0 |
| REQ-NO-02 | No new files for tokenOverlap, aliasExpansionScore, or similar matching utilities | P0 |
| REQ-NO-03 | The deterministic matching priority remains: valid rule → priority → textual match → id ASC | P0 |

## Scenarios

### SCEN-NO-01: rule-matching-engine.ts is unchanged

**Given** the file `src/lib/services/rule-matching-engine.ts` (or equivalent)
**When** inspecting its git diff for this change
**Then** there are zero changes to the file
**And** the file's SHA is identical before and after this change is deployed

### SCEN-NO-02: No new scoring files

**Given** the entire codebase for this change
**When** searching for files containing "tokenOverlap", "aliasExpansionScore", "intentScore", or any new scoring-related identifiers
**Then** no such files or identifiers exist
**And** the `package.json` has no new dependencies related to text matching or scoring

### SCEN-NO-03: Matching priority unchanged

**Given** a BankRule matching operation
**When** matching a transaction against all active rules
**Then** the match priority remains:
1. Valid rule (isActive = true)
2. Highest priority — lower number wins (priority ASC). In the codebase: `orderBy: { priority: 'asc' }`, null defaults to 99 (lowest priority).
3. Best textual match (conditionValue match quality)
4. Lowest ID (id ASC)

**And** the `intent` field on BankRule does NOT participate in the matching decision
**And** the matching engine does not reference or import TransactionIntent

## Enforcement

- **PR review gate**: Any diff touching `rule-matching-engine.ts` must be rejected unless explicitly approved as a separate follow-up change.
- **No intent-based matching**: The `intent` field is stored on BankRule but is NOT read by the matching engine in this change. Intent-based matching is explicitly deferred.
- **Test gate**: Existing matching engine tests must continue to pass without modification.

## Files Explicitly OUT OF SCOPE (must not change)

| File | Reason |
|------|--------|
| `src/lib/services/rule-matching-engine.ts` | No new scoring formulas |
| N/A — tokenOverlap, aliasExpansionScore | No new matching utilities |
| N/A — intent-based scoring | Deferred to future change |
