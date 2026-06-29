# No Scoring Changes (Negative Spec)

## Purpose

This is a negative specification — it explicitly defines what MUST NOT change during Transaction Intent implementation. The deterministic matching engine (`rule-matching-engine.ts`) must remain untouched. No new scoring formulas, no new matching utilities, no new fields that affect matching priority.

## Requirements

### Requirement: rule-matching-engine.ts Unchanged

rule-matching-engine.ts MUST NOT receive any new scoring formulas.

#### Scenario: rule-matching-engine.ts is unchanged

- GIVEN the file `src/lib/services/rule-matching-engine.ts` (or equivalent)
- WHEN inspecting its git diff for this change
- THEN there are zero changes related to Transaction Intent or scoring to the file
- AND the file's SHA is identical before and after this change is deployed (for scoring-related changes)

### Requirement: No New Scoring Files

No new files for tokenOverlap, aliasExpansionScore, or similar matching utilities.

#### Scenario: No new scoring files

- GIVEN the entire codebase for this change
- WHEN searching for files containing "tokenOverlap", "aliasExpansionScore", "intentScore", or any new scoring-related identifiers
- THEN no such files or identifiers exist
- AND the `package.json` has no new dependencies related to text matching or scoring

### Requirement: Matching Priority Unchanged

The deterministic matching priority remains: valid rule → priority → textual match → id ASC.

#### Scenario: Matching priority unchanged

- GIVEN a BankRule matching operation
- WHEN matching a transaction against all active rules
- THEN the match priority remains:
  1. Valid rule (isActive = true)
  2. Highest priority — lower number wins (priority ASC). In the codebase: `orderBy: { priority: 'asc' }`, null defaults to 99 (lowest priority).
  3. Best textual match (conditionValue match quality)
  4. Lowest ID (id ASC)
- AND the `intent` field on BankRule does NOT participate in the matching decision
- AND the matching engine does not reference or import TransactionIntent

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
