# Tasks: Pipeline Cleanup (Change #2b)

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| **Total tasks** | 15 |
| **Phases** | 5 |
| **New files** | 2 |
| **Modified files** | 7 |
| **New test files** | 1 |
| **Modified test files** | 3 (+1 optional) |
| **Estimated changed lines** | ~300–380 |
| **400-line budget risk** | Low |
| **Chained PRs recommended** | No |
| **Decision needed before apply** | No |
| **Review focus areas** | string-similarity extraction (bitwise accuracy), predictive engine algorithm impact (Levenshtein→JaroWinkler), zero-amount epsilon edge cases |
| **Compile-time safety** | High — `tsc --noEmit` catches all renames and removals |

---

## Phase 1 — string-similarity.ts + Re-export

**Goal**: Extract Jaro-Winkler to its own utility module and wire backward-compatible re-exports.

**Requirement mapping**: REQ-PRED-01, REQ-PRED-02, REQ-REX-01, REQ-REX-02, REQ-REX-03

### Task 1.1 [x] — Create `src/lib/utils/string-similarity.ts`

- **File**: `src/lib/utils/string-similarity.ts` (NEW)
- **Action**: Copy `jaro()` and `jaroWinkler()` implementations from `src/lib/services/entity-detector.ts` (lines ~116–168) into the new module with bitwise-identical logic.
- **Exports**:
  - `export function jaro(s1: string, s2: string): number`
  - `export function jaroWinkler(s1: string, s2: string): number`
- **Edge cases preserved**:
  - Identical strings → `1.0`
  - Empty strings → `0.0`
  - Zero matches → `0.0`
  - Strings with common prefix → Jaro-Winkler bonus applied
  - Short strings (len 1–2) → match window floor, no division by zero
- **Test script**: `npx vitest run tests/utils/string-similarity.test.ts` (written in Task 1.2)
- **Verification**: `diff` the extracted functions against the source to confirm bitwise identity
- **Depends on**: Nothing

### Task 1.2 [x] — Create `tests/utils/string-similarity.test.ts`

- **File**: `tests/utils/string-similarity.test.ts` (NEW)
- **Action**: Write unit tests for `jaro()` and `jaroWinkler()` covering:
  - Identical strings `("MERCADO LIBRE", "MERCADO LIBRE")` → `1.0`
  - Completely different `("MERCADO LIBRE", "ZZZZZZZZZZZZ")` → `<= 0.1`
  - Minor typo (trailing space) `("MERCADO LIBRE", "MERCADO LIBRE ")` → `>= 0.95`
  - Short strings `("AB", "AC")` → no division by zero
  - Long prefix match `("EXPRESO ARGENTINO S.A.", "EXPRESO ARGENTINO S.R.L.")` → `> 0.85`
  - Empty strings `("", "")` → `1.0`
  - One empty `("ABC", "")` → `0.0`
  - Exact match short `("A", "A")` → `1.0`
- **Depends on**: Task 1.1
- **Verification**: `npx vitest run tests/utils/string-similarity.test.ts` passes

### Task 1.3 [x] — Re-export from `entity-detector.ts`

- **File**: `src/lib/services/entity-detector.ts` (MODIFIED)
- **Action**:
  1. Remove lines ~115–168 (`jaro()` + `jaroWinkler()` implementations)
  2. Add re-export at top of file: `export { jaroWinkler, jaro } from '@/lib/utils/string-similarity'`
- **Verification**: `npx tsc --noEmit` passes; all existing imports `{ jaroWinkler } from '@/lib/services/entity-detector'` resolve correctly
- **Depends on**: Task 1.1

---

## Phase 2 — Zero-amount filters

**Goal**: Add epsilon-based zero-amount guards in all 3 clustering/classification loops.

**Requirement mapping**: REQ-ZERO-01, REQ-ZERO-02, REQ-ZERO-03, REQ-ZERO-04

### Task 2.1 [x] — Zero-amount guard in `clusterExact()`

- **File**: `src/lib/services/entity-detector.ts` (MODIFIED)
- **Action**: Insert inside `for (const tx of transactions)` loop (line ~318), before `let cleaned = ...`:
  ```typescript
  // Skip zero-amount transactions (epsilon-safe for Prisma Decimal)
  if (Math.abs(Number(tx.amount)) < 0.00001) continue;
  ```
- **Depends on**: Nothing (can run in parallel with Phase 1)
- **Verification**: Zero-amount transactions do not appear in any exact cluster

### Task 2.2 [x] — Zero-amount guard in `clusterFuzzy()`

- **File**: `src/lib/services/entity-detector.ts` (MODIFIED)
- **Action**: Insert inside `for (const tx of transactions)` loop (line ~385), before `const cleaned = ...`:
  ```typescript
  // Skip zero-amount transactions (epsilon-safe for Prisma Decimal)
  if (Math.abs(Number(tx.amount)) < 0.00001) continue;
  ```
- **Depends on**: Nothing
- **Verification**: Zero-amount transactions do not appear in any fuzzy cluster

### Task 2.3 [x] — Zero-amount guard in `computeDirectionProfile()`

- **File**: `src/lib/services/entity-classifier.ts` (MODIFIED)
- **Action**: Replace lines ~39–43:
  ```typescript
  const debitCount = transactions.filter((t) => Number(t.amount) < 0).length;
  const debitPct = debitCount / transactions.length;
  const creditPct = 1 - debitPct;
  ```
  With:
  ```typescript
  let debitCount = 0;
  let validCount = 0;
  for (const t of transactions) {
    const amount = Number(t.amount);
    if (Math.abs(amount) < 0.00001) continue;
    validCount++;
    if (amount < 0) debitCount++;
  }
  if (validCount === 0) return 'any';
  const debitPct = debitCount / validCount;
  const creditPct = 1 - debitPct;
  ```
- **Implication**: When ALL transactions are zero-amount, returns `'any'`. Prevents degenerate auto-rule creation.
- **Depends on**: Nothing
- **Verification**: Zero-amount transactions are excluded from debit/credit ratio computation

### Task 2.4 [x] — Add zero-amount tests to `entity-classifier.test.ts`

- **File**: `tests/services/entity-classifier.test.ts` (MODIFIED)
- **Action**: Add test cases to `computeDirectionProfile()` describe block:
  - 10 debit + 10 credit + 5 zero-amount → `debitPct: 0.50`, `creditPct: 0.50`
  - All zero-amount → returns `'any'`
  - Mixed with zero-amount → ratios computed against non-zero count only
- **Mock setup**: `bankTransaction.findMany` returns transactions including zero-amount entries
- **Depends on**: Task 2.3
- **Verification**: `npx vitest run tests/services/entity-classifier.test.ts` passes all new and existing tests

---

## Phase 3 — Direction consolidation

**Goal**: Unify direction function naming, export canonical `classifyDirection`, rename `resolveDirection` to `majorityDirection`, remove `checkRoleDirectionMismatch`, delegate to canonical validator.

**Requirement mapping**: REQ-DIR-01, REQ-DIR-02, REQ-VAL-01, REQ-VAL-03

### Task 3.1 [x] — Export `classifyDirection()` from `direction-filter.ts`

- **File**: `src/lib/services/direction-filter.ts` (MODIFIED)
- **Actions**:
  1. Add `export` to `function classifyDirection(...)` (line ~22)
  2. Export the `DirectionProfile` type (or inline the return type):
     ```typescript
     export type DirectionProfile = 'credit' | 'debit' | 'ambas';
     ```
- **No logic changes** — only visibility changes
- **Depends on**: Nothing
- **Verification**: `npx tsc --noEmit` passes; other modules can now import `classifyDirection`

### Task 3.2 [x] — Rename `resolveDirection()` → `majorityDirection()` in `entity-enricher.ts`

- **File**: `src/lib/services/entity-enricher.ts` (MODIFIED)
- **Actions**:
  1. Rename function: `resolveDirection(candidate) → majorityDirection(candidate)`
  2. Update return type comment if needed (same: `'debit' | 'credit' | null`)
  3. Update internal call at line ~269: `const direction = majorityDirection(candidate);`
- **Depends on**: Nothing
- **Verification**: `npx tsc --noEmit` fails if any other caller references `resolveDirection` (expected — updates in Task 3.5)

### Task 3.3 [x] — Remove `checkRoleDirectionMismatch()` from `entity-enricher.ts`

- **File**: `src/lib/services/entity-enricher.ts` (MODIFIED)
- **Actions**:
  1. Delete the entire `checkRoleDirectionMismatch()` function (lines ~174–211)
  2. Add import: `import { roleIsValidForDirection } from '@/lib/services/direction-filter';`
  3. Replace lines ~286-289 (Step 6 in `enrichCandidates()`):
     ```typescript
     // Step 6: check role ↔ direction mismatch via canonical validator
     const roleToCheck = context?.role ?? '';
     const directionWarning = roleToCheck
       ? (() => {
           const result = roleIsValidForDirection(roleToCheck, candidate.directionProfile);
           if (!result.valid) return { warning: result.reason ?? `Direction mismatch for role ${roleToCheck}` };
           return null;
         })()
       : null;
     ```
- **Depends on**: Task 3.1 (roleIsValidForDirection is already exported)
- **Verification**: `npx tsc --noEmit` passes; direction validation behavior preserved

### Task 3.4 [x] — Update `entity-enricher.test.ts` for direction changes

- **File**: `tests/services/entity-enricher.test.ts` (MODIFIED)
- **Actions**:
  1. `resolveDirection` → `majorityDirection` in import and test names (lines ~2–7, ~206–234)
  2. Remove `checkRoleDirectionMismatch` from import (line ~7)
  3. Delete `checkRoleDirectionMismatch` describe block (lines ~236–284)
  4. Update `enrichCandidates` Step 6 assertion: `directionWarning` now comes from `roleIsValidForDirection().reason` instead of `checkRoleDirectionMismatch()`. Adjust assertion shape accordingly.
- **Depends on**: Task 3.2, Task 3.3
- **Verification**: `npx vitest run tests/services/entity-enricher.test.ts` passes all tests

### Task 3.5 [x] — Add `classifyDirection` tests to `direction-filter.test.ts`

- **File**: `tests/services/direction-filter.test.ts` (MODIFIED)
- **Action**: Add describe block for `classifyDirection` with scenarios:
  - `creditPct >= 0.8` → `'credit'`
  - `debitPct >= 0.8` → `'debit'`
  - Neither >= 0.8 → `'ambas'` (e.g., `0.5/0.5`)
  - Zero profile `{ creditPct: 0, debitPct: 0 }` → `'ambas'`
  - Boundary at exactly 0.8 → credit or debit (not `'ambas'`)
- **Existing `roleIsValidForDirection` tests**: Unchanged (no logic change)
- **Depends on**: Task 3.1
- **Verification**: `npx vitest run tests/services/direction-filter.test.ts` passes all tests

---

## Phase 4 — Predictive algorithm swap

**Goal**: Replace inline Levenshtein distance with Jaro-Winkler in the predictive engine.

**Requirement mapping**: REQ-PRED-03, REQ-PRED-04

### Task 4.1 [x] — Replace Levenshtein with Jaro-Winkler in `predictive-engine.ts`

- **File**: `src/lib/reconciliation/predictive-engine.ts` (MODIFIED)
- **Actions**:
  1. Remove inline `levenshtein()` function (lines ~6–19)
  2. Add import: `import { jaroWinkler } from '@/lib/utils/string-similarity';`
  3. Replace line ~82:
     ```typescript
     // Before:
     const maxLen = Math.max(desc1.length, desc2.length);
     const textScore = maxLen === 0 ? 1 : 1 - levenshtein(desc1, desc2) / maxLen;
     
     // After:
     const textScore = jaroWinkler(desc1, desc2);
     ```
  4. Remove the `maxLen === 0` guard — `jaroWinkler("", "")` returns `1.0` natively.
- **Confidence formula unchanged**: `weights.amount * amountScore + weights.date * dateScore + weights.description * textScore + weights.historicalFrequency * historyScore` still works with 0.0–1.0 range.
- **Depends on**: Phase 1 (string-similarity.ts must exist)
- **Verification**: `npx tsc --noEmit` passes; `npx vitest run` (all tests) passes

### Task 4.2 [x] — Verify predictive engine test fixtures (if any exist)

- **Action**: Search for any test files matching `*predictive*` or `*reconciliation*` patterns.
- **If tests exist**: Update expected score values in test fixtures to match Jaro-Winkler output. Jaro-Winkler produces different scores than `1 - lev/maxLen` for the same strings.
- **If no tests exist**: No action needed. Document this as a gap for future improvement.
- **Depends on**: Task 4.1
- **Verification**: All tests pass after score recalibration (if applicable)

---

## Phase 5 — Config cleanup + regression tests

**Goal**: Remove unused `directionLockThreshold` config and run full regression suite.

**Requirement mapping**: REQ-DIR-01 (removed requirement for `directionLockThreshold`)

### Task 5.1 [x] — Remove `directionLockThreshold` from config and interface

- **File**: `rules/entity-detection.json` (MODIFIED)
- **Action**: Remove `"directionLockThreshold": 0.90` from the `validation` object.
- **Result**:
  ```json
  {
    "validation": {
      "minOccurrences": 2,
      "ignorePatterns": ["CASH", "CHECK", "FEE", "INTEREST", "BALANCE", "MOBILE"]
    }
  }
  ```

- **File**: `src/lib/services/entity-detector.ts` (MODIFIED)
- **Actions**:
  1. Remove `directionLockThreshold?: number` from `EntityDetectionConfig.validation` interface
  2. Remove `directionLockThreshold: 0.90` from `DEFAULT_ENTITY_DETECTION_CONFIG.validation`

- **Depends on**: Nothing
- **Verification**: `npx tsc --noEmit` passes; no runtime config reference fails

### Task 5.2 [x] — Full regression run

- **Action**: Run the complete test suite:
  ```
  npx vitest run
  ```
- **Verification criteria**:
  - All 200+ existing tests pass (no regression)
  - New tests for string-similarity, zero-amount, classifyDirection, majorityDirection all pass
  - `npx tsc --noEmit` produces zero errors
- **Depends on**: All preceding tasks (Phase 1–5.1)
- **Rollback criteria**: If any existing test fails, investigate before proceeding. Known allowable changes:
  - `entity-enricher.test.ts`: compile errors expected until Task 3.4 is applied
  - `predictive-engine` test scores: may need recalibration if tests exist

---

## Task Dependency Graph

```
Phase 1                Phase 2                Phase 3                Phase 4                Phase 5
──────                 ──────                 ──────                 ──────                 ──────
1.1 (string-sim.ts)    2.1 (clusterExact)     3.1 (export classify)  4.1 (pred engine)      5.1 (config)
    │                  2.2 (clusterFuzzy)     3.2 (rename resolve)       │                   5.2 (full regr)
    ├── 1.2 (tests)    2.3 (compDirProfile)   3.3 (rm checkRole)        └── 4.2 (verify     ◄── depends on all
    └── 1.3 (re-exp)   2.4 (classifier tests)     ├── 3.4 (enricher       fixtures)
                                                  │      tests)
                                                  3.5 (dir-filter
                                                       tests)
```

**Parallelizable groups**:
- Phase 1, Phase 2, Phase 3.1, Task 5.1 — can run concurrently (no code dependencies)
- Phase 4 depends on Phase 1.1 (string-similarity.ts must exist)
- Tasks 3.4 and 3.5 depend on 3.1–3.3
- Task 5.2 depends on everything

## Task Summary

| # | Task | File(s) | Type | Depends On |
|---|------|---------|------|------------|
| 1.1 | Create string-similarity.ts | `src/lib/utils/string-similarity.ts` (NEW) | Source | — |
| 1.2 | Create string-similarity.test.ts | `tests/utils/string-similarity.test.ts` (NEW) | Test | 1.1 |
| 1.3 | Re-export from entity-detector.ts | `src/lib/services/entity-detector.ts` | Source | 1.1 |
| 2.1 | Zero-amount guard in clusterExact | `src/lib/services/entity-detector.ts` | Source | — |
| 2.2 | Zero-amount guard in clusterFuzzy | `src/lib/services/entity-detector.ts` | Source | — |
| 2.3 | Zero-amount guard in computeDirectionProfile | `src/lib/services/entity-classifier.ts` | Source | — |
| 2.4 | Zero-amount tests for classifier | `tests/services/entity-classifier.test.ts` | Test | 2.3 |
| 3.1 | Export classifyDirection() | `src/lib/services/direction-filter.ts` | Source | — |
| 3.2 | Rename resolveDirection→majorityDirection | `src/lib/services/entity-enricher.ts` | Source | — |
| 3.3 | Remove checkRoleDirectionMismatch | `src/lib/services/entity-enricher.ts` | Source | 3.1 |
| 3.4 | Update enricher tests | `tests/services/entity-enricher.test.ts` | Test | 3.2, 3.3 |
| 3.5 | Add classifyDirection tests | `tests/services/direction-filter.test.ts` | Test | 3.1 |
| 4.1 | Replace Levenshtein with Jaro-Winkler | `src/lib/reconciliation/predictive-engine.ts` | Source | 1.1 |
| 4.2 | Verify predictive engine fixtures | `*predictive*` test files (if exist) | Test | 4.1 |
| 5.1 | Remove directionLockThreshold | `rules/entity-detection.json`, `entity-detector.ts` | Config+Source | — |
| 5.2 | Full regression suite | — | Verify | All |

**Total**: 15 tasks (including verification), 5 phases
