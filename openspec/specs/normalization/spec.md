# Normalization Specification — Delta

## Purpose

Define the single canonical `normalizePattern()` function that replaces the 4 diverging normalizers across all detection pipelines, and the one-shot migration script that re-normalizes all existing `BankRule.pattern` values with collision handling.

## Dependencies

- **Depends on**: `openspec/specs/rule-matching-engine/spec.md` (existing normalization requirement REQ-MATCH-01 will be replaced by this delta)
- **Depends on**: `openspec/specs/entity-classification/spec.md` (classification auto-create uses the same normalization)
- **Deprecates**: `normalizePattern()` vs `sanitizeDescriptionForDetection()` vs `sanitizeDescriptionForAdaptive()` vs raw inline normalization in `rule-matching-engine`

---

## Section 1: Canonical Normalization

### REQ-NORM-01 — Single canonical `normalizePattern()`

The system MUST expose a single exported function `normalizePattern(input: string): string` at `src/lib/services/pattern-normalizer.ts`. This function SHALL be the ONLY pattern normalization function in the codebase. The existing `sanitizeDescriptionForDetection()`, `sanitizeDescriptionForAdaptive()`, and the raw inline normalization in `rule-matching-engine.evaluateCondition()` MUST be removed and all call sites MUST delegate to `normalizePattern()`.

The canonical normalization algorithm SHALL be, in order:

1. **Trim**: strip leading/trailing whitespace
2. **Collapse whitespace**: replace any sequence of whitespace characters (spaces, tabs, newlines) with a single ASCII space
3. **Lowercase**: convert to lowercase via `toLowerCase()`
4. **Strip punctuation**: remove standard punctuation characters (`. , ; : ! ? " ' ( ) [ ] { } / \\ | ` ~ @ # $ % ^ & * - + = < >`)
5. **Collapse whitespace again**: after stripping punctuation, collapse any newly-adjacent whitespace
6. **Trim again**: strip leading/trailing whitespace after collapse

This algorithm MUST NOT strip `INDN:`, `DES:`, or other prefixes — those are domain-specific concerns that must be handled by the caller or via configurable `stripPatterns` in the centralized config. The function MUST be a pure function with no I/O, no side effects, and no external dependencies.

#### Scenario: Same result across all pipelines

- GIVEN the input string `"  INTERES  BANCARIO  "`
- WHEN `normalizePattern` is called
- THEN the result MUST be `"interes bancario"`
- AND ALL 4 replaced call sites (rule-matching-engine evaluateCondition, inline rule-matching, sanitizeDescriptionForDetection, sanitizeDescriptionForAdaptive) MUST produce bitwise-equal results for ANY input

#### Scenario: Whitespace normalization

- GIVEN `"ACME\tCORP\nSA"` (tab and newline in input)
- WHEN `normalizePattern` is called
- THEN the result MUST be `"acme corp sa"` (single spaces, no tabs or newlines)

#### Scenario: Punctuation stripped

- GIVEN `"MERCADO LIBRE S.A. - (CUIT 30-..."` 
- WHEN `normalizePattern` is called
- THEN the result MUST be `"mercado libre sa cuit 30"` (punctuation removed, spaces collapsed)

#### Scenario: Unicode characters preserved (but lowercased)

- GIVEN `"Café Martínez"`
- WHEN `normalizePattern` is called
- THEN `"café martínez"` — accented characters are preserved, only ASCII punctuation is stripped
- AND the result must be reproducible across Node.js runtimes

#### Scenario: Empty input

- GIVEN an empty string `""`
- WHEN `normalizePattern` is called
- THEN the result MUST be `""` (empty string, no error)

#### Scenario: Input with only punctuation

- GIVEN `"!@#$%^&*()"`
- WHEN `normalizePattern` is called
- THEN the result MUST be `""` (empty string — all characters are punctuation)

#### Scenario: Numeric input preserved

- GIVEN `"1234-5678/90"`
- WHEN `normalizePattern` is called
- THEN the result MUST be `"1234567890"` (dash and slash are punctuation, removed)

---

### REQ-NORM-02 — All pipelines use the same function

The following call sites MUST be migrated to use `normalizePattern()`:

| # | Pipeline | Current Normalizer | Impact |
|---|----------|-------------------|--------|
| 1 | Rule-matching-engine `evaluateCondition()` | Inline: lowercase + trim + collapse spaces | Highest — same normalization used for ALL rule matching across the system |
| 2 | Entity-detector `clusterCandidates()` (exact mode) | `sanitizeDescriptionForDetection()` — strips entity-detection.json stripPatterns | Matches via normalized-key equality |
| 3 | Adaptive-engine `generateCandidateRules()` | `sanitizeDescriptionForAdaptive()` — strips learning-engine.json sanitizeNoise | Pattern generation for feedback |
| 4 | AI-rules scan `buildScanPattern()` | `sanitizeDescriptionForDetection()` | AI-generated pattern candidates |

The migration MUST preserve the same match outcome for each pipeline. If a pipeline previously used domain-specific stripping (e.g., `INDN:` prefix removal), that logic MUST be moved to a separate pre-processing step before `normalizePattern()`, documented at the call site.

#### Scenario: Rule-matching normalized match set unchanged

- GIVEN a set of 100 BankRule patterns and 500 transactions
- WHEN the engine uses `normalizePattern()` instead of inline normalization
- THEN the set of matched (rule, transaction) pairs MUST be identical to pre-migration
- AND any difference MUST be documented as a known behavioral change

#### Scenario: Domain-specific prefix stripping preserved

- GIVEN a transaction description `"INDN: ACME CORP"` and a rule pattern `"INDN: ACME CORP"`
- WHEN the rule-matching engine normalizes both via `normalizePattern()` AFTER stripping the `INDN:` prefix
- THEN the match MUST succeed (pre-processing preserves the domain stripping)

#### Scenario: No regressions in entity-classifier tests

- GIVEN 35 existing tests at `tests/services/entity-classifier.test.ts`
- WHEN `normalizePattern()` replaces `sanitizeDescriptionForDetection()` in entity-classifier calls
- THEN all 35 existing tests MUST pass without modification

---

## Section 2: One-Shot Migration

### REQ-MIG-01 — Migration script normalizes all existing BankRule.pattern values

A one-shot migration script MUST exist at `scripts/normalization-migration.ts`. The script SHALL:

1. Fetch ALL `BankRule` records from the database, grouped by `companyId`
2. For each rule, apply `normalizePattern(currentPattern)` to produce `newPattern`
3. If `newPattern === currentPattern`, skip the rule (no change)
4. If `newPattern !== currentPattern`, update the record with the normalized value
5. Generate a detailed `migration-report.json` (see REQ-MIG-05)

The script MUST run as a standalone Node.js entry point (e.g., `npx tsx scripts/normalization-migration.ts`). It MUST support a `--dry-run` flag that prints what would change without modifying data.

#### Scenario: Dry run shows expected changes without mutation

- GIVEN a BankRule with `pattern="  INTERES  BANCARIO  "`
- WHEN the script runs with `--dry-run`
- THEN it prints `Rule [id]: "  INTERES  BANCARIO  " → "interes bancario"`
- AND the database record is NOT modified

#### Scenario: Already-normalized rule is skipped

- GIVEN a BankRule with `pattern="interes bancario"` (already normalized)
- WHEN the script runs
- THEN the rule is listed as "skipped" in the report
- AND no UPDATE query is executed for that rule

---

### REQ-MIG-02 — Collision detection within same company

After normalizing each pattern, the script MUST detect collisions: two or more BankRules within the same `companyId` whose `normalizePattern()` result is identical but whose current `pattern` values differ.

#### Scenario: Collision detected between two rules

- GIVEN Company "comp_1" has:
  - Rule A: `pattern="  INTERES  "`, `glAccountId="gl_001"`
  - Rule B: `pattern="INTERES"`, `glAccountId="gl_002"`
- WHEN the migration script normalizes both
- THEN both produce `"interes"` — a collision is detected
- AND the collision is written to the report with both rule IDs and GL accounts

---

### REQ-MIG-03 — Same-GL collision: consolidate

When two colliding rules have the same `glAccountId`, the system MUST consolidate:

1. Determine the **survivor**: prefer the rule where `isManuallyEdited=true`; if neither or both are manual, prefer the most recent `updatedAt`
2. Update the survivor's pattern to the normalized value, ensure `isActive=true`
3. **Deactivate** the other rule: set `isActive=false`, `entityContextId=null` (if set)
4. Log an audit event with rule IDs, normalized pattern, and consolidation reason

#### Scenario: Consolidation with one manually edited rule

- GIVEN:
  - Rule A: `pattern="INTERES"`, `glAccountId="gl_001"`, `isManuallyEdited=true`, `updatedAt=2024-01-01`
  - Rule B: `pattern="  INTERES  "`, `glAccountId="gl_001"`, `isManuallyEdited=false`, `updatedAt=2024-06-01`
- WHEN migration processes this collision
- THEN Rule A (manually edited) survives — pattern stays `"interes"`, stays active
- AND Rule B is deactivated: `isActive=false`, `entityContextId=null`
- AND an audit event records the consolidation

#### Scenario: Consolidation when neither is manually edited

- GIVEN:
  - Rule A: `pattern="INTERES"`, `glAccountId="gl_001"`, `isManuallyEdited=false`, `updatedAt=2024-01-01`
  - Rule B: `pattern="  INTERES  "`, `glAccountId="gl_001"`, `isManuallyEdited=false`, `updatedAt=2024-06-01`
- WHEN migration processes this collision
- THEN Rule B (most recent `updatedAt`) survives
- AND Rule A is deactivated

#### Scenario: No collision, normal update

- GIVEN a single rule with `pattern="  INTERES  "` and no other rules in the same company with matching normalized pattern
- WHEN migration processes it
- THEN the rule pattern is updated to `"interes"`
- AND no deactivation occurs

---

### REQ-MIG-04 — Different-GL collision: log CRITICAL, keep both active

When two colliding rules have **different** `glAccountId`, the system MUST:

1. Update both rule patterns to the normalized value
2. Keep both rules active (do NOT deactivate either)
3. Log a CRITICAL-level log entry with rule IDs, normalized pattern, and both GL account IDs
4. Include the collision in the report under a `critical` section

This is a data-integrity decision: different GL accounts for the same normalized pattern likely indicate a configuration error that requires human review. The migration script must NOT silently resolve it.

#### Scenario: Different-GL collision emits CRITICAL log

- GIVEN:
  - Rule A: `pattern="INTERES"`, `glAccountId="gl_001"`
  - Rule B: `pattern="  INTERES  "`, `glAccountId="gl_999"`
- WHEN migration processes this collision
- THEN both rules are updated to `"interes"` pattern
- AND both remain active
- AND a CRITICAL log entry includes: rule IDs `[A, B]`, pattern `"interes"`, GL accounts `["gl_001", "gl_999"]`

#### Scenario: Critical collision does not abort the migration

- GIVEN a critical collision between rules A and B
- WHEN the migration continues processing remaining rules
- THEN the script does NOT exit or throw
- AND remaining rules are processed normally
- AND the final report includes all critical collisions

---

### REQ-MIG-05 — migration-report.json

The script MUST generate a JSON file at the output path (configurable, defaults to project root) with this schema:

```json
{
  "runAt": "ISO datetime",
  "dryRun": boolean,
  "summary": {
    "totalRules": number,
    "updated": number,
    "skipped": number,
    "collisions": number,
    "critical": number
  },
  "updated": [
    { "ruleId": "string", "oldPattern": "string", "newPattern": "string", "companyId": "string" }
  ],
  "skipped": [
    { "ruleId": "string", "pattern": "string", "companyId": "string", "reason": "already_normalized" }
  ],
  "collisions": [
    {
      "normalizedPattern": "string",
      "companyId": "string",
      "sameGl": [
        {
          "survivorId": "string",
          "deactivatedId": "string",
          "glAccountId": "string",
          "reason": "manual|updatedAt",
          "auditLogged": true
        }
      ],
      "differentGl": [
        {
          "ruleIds": ["string", "string"],
          "glAccountIds": ["string", "string"],
          "criticalLogged": true
        }
      ]
    }
  ],
  "errors": [
    { "ruleId": "string", "error": "string" }
  ]
}
```

#### Scenario: Report contains all sections

- GIVEN a company with 5 rules: 1 unchanged, 2 updated without collision, 2 colliding with same GL
- WHEN migration completes
- THEN the report contains `summary.updated=2`, `summary.skipped=1`, `summary.collisions=1`, `summary.critical=0`
- AND each section is populated with the correct data

#### Scenario: Error in single rule does not halt migration

- GIVEN a rule that fails to update (e.g., DB constraint violation)
- WHEN migration processes that rule
- THEN the error is recorded in `errors[]`
- AND the script continues processing remaining rules
- AND the exit code is non-zero only if no rules were processed successfully

---

## Non-Goals

- Direction inference normalization (deferred to future change)
- Predictive engine normalization (Levenshtein — different algorithm, not in scope)
- Fuzzy match threshold changes (handled by centralized config spec)
- Frontend pattern display changes
