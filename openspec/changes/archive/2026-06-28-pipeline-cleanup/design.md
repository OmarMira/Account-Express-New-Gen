# Design: Pipeline Cleanup (Change #2b)

## 1. Architecture Overview

### Before (Current State)

```
src/lib/utils/
  decimal.ts                           ← toNum() for Prisma Decimal

src/lib/services/
  entity-detector.ts                   ← jaro(), jaroWinkler(), clusterExact(), clusterFuzzy()  
  entity-classifier.ts                 ← computeDirectionProfile() [>0.8 inline, no zero-amount guard]
  entity-enricher.ts                   ← resolveDirection() [>0.5], checkRoleDirectionMismatch()
  direction-filter.ts                  ← classifyDirection() [private, >=0.8], roleIsValidForDirection()

src/lib/reconciliation/
  predictive-engine.ts                 ← levenshtein() [inline], 1 - lev/maxLen

rules/
  entity-detection.json                ← validation.directionLockThreshold: 0.90 (unused)
```

Direction state: 3 functions with 3 thresholds, direction validation duplicated in enricher, zero-amount never filtered, predictive engine uses Levenshtein.

### After (Target State)

```
src/lib/utils/
  decimal.ts
  string-similarity.ts                 ← NEW: jaro(), jaroWinkler() extracted from entity-detector

src/lib/services/
  entity-detector.ts                   ← re-exports { jaroWinkler, jaro } from string-similarity;
                                         clusterExact() zero-amount guard;
                                         clusterFuzzy() zero-amount guard
  entity-classifier.ts                 ← computeDirectionProfile() zero-amount guard
  entity-enricher.ts                   ← resolveDirection() → majorityDirection();
                                         checkRoleDirectionMismatch() removed →
                                         enrichCandidates() delegates to roleIsValidForDirection()
  direction-filter.ts                  ← classifyDirection() [now exported, >=0.8];
                                         roleIsValidForDirection() [canonical validator, unchanged]

src/lib/reconciliation/
  predictive-engine.ts                 ← jaroWinkler() from string-similarity (replaces Levenshtein)

rules/
  entity-detection.json                ← validation.directionLockThreshold removed
```

Direction state: 2 exported functions with clear semantics (`classifyDirection` ≥0.8 for purity, `majorityDirection` >0.5 for tendency). Single canonical validator.

---

## 2. Component Designs

### 2.1. `src/lib/utils/string-similarity.ts` — NEW

**Purpose**: Pure utility module for string similarity algorithms. Extracted from `entity-detector.ts` with bitwise-identical implementation.

**Interfaces**:

```typescript
/**
 * Jaro similarity between two strings.
 * Returns 0.0 (completely different) to 1.0 (identical).
 * Internal helper for jaroWinkler.
 */
export function jaro(s1: string, s2: string): number;

/**
 * Jaro-Winkler similarity between two strings.
 * Applies a prefix bonus of up to 0.1 per matching first-4 characters
 * when the raw Jaro score is ≥ 0.7.
 * Returns 0.0 to 1.0.
 */
export function jaroWinkler(s1: string, s2: string): number;
```

**Implementation**: Copy-paste from `entity-detector.ts` lines 116–168. No algorithmic changes.

**Edge cases preserved**:
- Identical strings → `1.0`
- Empty strings → `0.0`
- Zero matches → `0.0`
- Strings with common prefix → Jaro-Winkler bonus applied
- Short strings (len 1–2) → match window floor, no division by zero

---

### 2.2. `src/lib/services/entity-detector.ts` — MODIFIED

**Changes**:

**a) Re-export jaro/jaroWinkler** (replace implementation):

```typescript
// Remove lines 115-168 (jaro() + jaroWinkler() implementations)
// Add at top of file:
export { jaroWinkler, jaro } from '@/lib/utils/string-similarity';
```

**b) Zero-amount guard in `clusterExact()`**:

Insert at line 318, inside `for (const tx of transactions)` loop, before the `let cleaned = ...` line:

```typescript
// Skip zero-amount transactions (epsilon-safe for Prisma Decimal)
if (Math.abs(Number(tx.amount)) < 0.00001) continue;
```

**c) Zero-amount guard in `clusterFuzzy()`**:

Insert at line 385, inside `for (const tx of transactions)` loop, before `const cleaned = ...`:

```typescript
// Skip zero-amount transactions (epsilon-safe for Prisma Decimal)
if (Math.abs(Number(tx.amount)) < 0.00001) continue;
```

**d) Remove `directionLockThreshold` from config**:

- Interface `EntityDetectionConfig.validation.directionLockThreshold` → **REMOVE**
- Default `DEFAULT_ENTITY_DETECTION_CONFIG.validation.directionLockThreshold: 0.90` → **REMOVE**

**No other changes**. All other exports, functions, and signatures remain identical.

---

### 2.3. `src/lib/services/entity-classifier.ts` — MODIFIED

**Change: Zero-amount guard in `computeDirectionProfile()`**:

Current implementation (lines 39–43):
```typescript
const debitCount = transactions.filter((t) => Number(t.amount) < 0).length;
const debitPct = debitCount / transactions.length;
const creditPct = 1 - debitPct;
```

New implementation:
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

**Return type**: Unchanged — still `Promise<'debit' | 'credit' | 'any'>`.

**Implications**: When ALL transactions for a pattern are zero-amount, returns `'any'`. This is safe because a zero-amount-only entity is degenerate and should not trigger auto-rule creation (the rule will have no meaningful direction).

---

### 2.4. `src/lib/services/direction-filter.ts` — MODIFIED

**Changes**:

**a) Export `classifyDirection()`** (line 22 → add `export`):

```typescript
export function classifyDirection(profile: { creditPct: number; debitPct: number }): 'credit' | 'debit' | 'ambas' {
  if (profile.creditPct >= DIRECTION_THRESHOLD) return 'credit';
  if (profile.debitPct >= DIRECTION_THRESHOLD) return 'debit';
  return 'ambas';
}
```

Update the local `DirectionProfile` type alias to export or remove in favor of an inline return type. Previously the return was `DirectionProfile` (a local type alias `'credit' | 'debit' | 'ambas'`). Export the type alias or inline it.

```typescript
export type DirectionProfile = 'credit' | 'debit' | 'ambas';
```

**b) `roleIsValidForDirection()`** — No logic changes. Already the canonical validator. Already exported. Already uses `classifyDirection()` internally.

**Summary of direction-filter.ts changes**:
- Add `export` to `classifyDirection()` function
- Export `DirectionProfile` type (or inline return type)

---

### 2.5. `src/lib/services/entity-enricher.ts` — MODIFIED

**Changes**:

**a) Rename `resolveDirection()` → `majorityDirection()`**:

```typescript
// Rename:
export function majorityDirection(candidate: EntityCandidate): 'debit' | 'credit' | null {
  const { creditPct, debitPct } = candidate.directionProfile;
  if (debitPct > 0.5) return 'debit';
  if (creditPct > 0.5) return 'credit';
  return null;
}
```

Update internal call at line 269:
```typescript
const direction = majorityDirection(candidate);
```

**b) Remove `checkRoleDirectionMismatch()`**:

Delete the entire function (lines 174–211). This was the duplicated direction validation logic.

**c) Update `enrichCandidates()`** (line 285–288):

Replace the local `checkRoleDirectionMismatch` call with `roleIsValidForDirection` from direction-filter.ts.

Add import:
```typescript
import { roleIsValidForDirection } from '@/lib/services/direction-filter';
```

Replace lines 286-289:
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

The `directionWarning` field on `EnrichedCandidate` stays `string | null` — the warning message is now sourced from `roleIsValidForDirection()`'s `reason` field.

**Backward compatibility note**: `resolveDirection` is imported by `scan/route.ts` via `entity-enricher`. The `route.ts` only imports `enrichCandidates` and `buildScanPattern`, not `resolveDirection` directly. The test file imports `resolveDirection` — will need to be updated (see test strategy).

---

### 2.6. `src/lib/reconciliation/predictive-engine.ts` — MODIFIED

**Changes**:

**a) Remove inline `levenshtein()`** (lines 6–19) — delete the function entirely.

**b) Add import**:
```typescript
import { jaroWinkler } from '@/lib/utils/string-similarity';
```

**c) Replace usage** (line 82):

```typescript
// Before:
const maxLen = Math.max(desc1.length, desc2.length);
const textScore = maxLen === 0 ? 1 : 1 - levenshtein(desc1, desc2) / maxLen;

// After:
const textScore = jaroWinkler(desc1, desc2);
```

**Rationale**: JaroWinkler returns `0.0–1.0` natively, so no normalization needed. The Levenshtein approach already returned `0.0–1.0` via `1 - lev/maxLen`, so the scoring context is preserved. `jaroWinkler("", "")` returns `1.0` (identical strings) — the `maxLen === 0` guard is no longer needed.

**Confidence score calculation**: The existing formula at lines 87–91:
```typescript
weights.amount * amountScore +
weights.date * dateScore +
weights.description * textScore +
weights.historicalFrequency * historyScore;
```
— is unchanged. `textScore` remains 0.0–1.0, so no rescaling needed.

---

### 2.7. `rules/entity-detection.json` — MODIFIED

Remove the `validation.directionLockThreshold` field:

```json
{
  "validation": {
    "minOccurrences": 2,
    "ignorePatterns": ["CASH", "CHECK", "FEE", "INTEREST", "BALANCE", "MOBILE"]
  }
}
```

---

### 2.8. `EntityOnboardingModal.tsx` — NOT IN SCOPE

The frontend component `src/components/learning/EntityOnboardingModal.tsx` has its own local `checkRoleDirectionMismatch` function (line 61). This is a separate copy, not the service-layer function being removed. It is **not in scope** for this change. The spec explicitly limits changes to the service layer.

---

## 3. Data Model Changes

**None**. No Prisma schema, no database migration, no new tables or columns.

**Config changes only**:
- `rules/entity-detection.json`: Remove `validation.directionLockThreshold` field
- `src/lib/services/entity-detector.ts`: Remove `directionLockThreshold` from both `EntityDetectionConfig` interface and `DEFAULT_ENTITY_DETECTION_CONFIG`

---

## 4. Test Strategy

### 4.1. New tests

**`tests/utils/string-similarity.test.ts`** — Unit tests for the extracted Jaro-Winkler module:

| Scenario | Input | Expected |
|----------|-------|----------|
| Identical strings | `("MERCADO LIBRE", "MERCADO LIBRE")` | `1.0` |
| Completely different | `("MERCADO LIBRE", "ZZZZZZZZZZZZ")` | `<= 0.1` |
| Minor typo (trailing space) | `("MERCADO LIBRE", "MERCADO LIBRE ")` | `>= 0.95` |
| Short strings | `("AB", "AC")` | no division by zero |
| Long prefix match | `("EXPRESO ARGENTINO S.A.", "EXPRESO ARGENTINO S.R.L.")` | `> 0.85` |
| Empty strings | `("", "")` | `1.0` |
| One empty | `("ABC", "")` | `0.0` |
| Exact match short | `("A", "A")` | `1.0` |

### 4.2. Modified tests

**`tests/services/entity-detector.test.ts`**: No change expected. The re-export preserves function behavior. Cluster tests include transactions with non-zero amounts only (already the case in existing fixtures).

**`tests/services/entity-classifier.test.ts`** — Add to `computeDirectionProfile()` describe block:

- Zero-amount transactions skipped → 10 debit + 10 credit + 5 zero-amount → `'any'` (50/50 after skipping zeros)
- All zero-amount → returns `'any'`
- Mixed with zero-amount skewing → debit/credit ratios computed against non-zero count only

Mock setup: `bankTransaction.findMany` returns transactions including zero-amount entries.

**`tests/services/entity-enricher.test.ts`** — Changes required:

- `resolveDirection` → `majorityDirection` in import and test names (lines 2–7, 206–234)
- Remove `checkRoleDirectionMismatch` from import (line 7)
- Delete `checkRoleDirectionMismatch` describe block (lines 236–284)
- Update `enrichCandidates` test for Step 6: the `directionWarning` now comes from `roleIsValidForDirection()` instead of `checkRoleDirectionMismatch()`. The return type differs slightly (`{ valid: boolean; reason?: string }` vs `{ warning: string } | null`). Adjust assertions on `directionWarning`.

**`tests/services/direction-filter.test.ts`** — Add tests:

- `classifyDirection` is now exported — add direct unit tests
- Existing `roleIsValidForDirection` tests unchanged (no logic change)

New describe block for `classifyDirection`:

```typescript
describe('classifyDirection', () => {
  it('returns "credit" when creditPct >= 0.8', () => {
    expect(classifyDirection({ creditPct: 0.8, debitPct: 0.2 })).toBe('credit');
  });
  it('returns "debit" when debitPct >= 0.8', () => {
    expect(classifyDirection({ creditPct: 0.2, debitPct: 0.8 })).toBe('debit');
  });
  it('returns "ambas" when neither >= 0.8', () => {
    expect(classifyDirection({ creditPct: 0.5, debitPct: 0.5 })).toBe('ambas');
  });
  it('returns "ambas" for zero profile', () => {
    expect(classifyDirection({ creditPct: 0, debitPct: 0 })).toBe('ambas');
  });
});
```

**`tests/services/predictive-engine.test.ts`**: The existing tests reference `levenshtein` or specific similarity scores. Since no test file exists at `tests/services/predictive-engine.test.ts` or `tests/reconciliation/predictive-engine.test.ts`, we check:

- No test files found matching `*predictive*`. If no tests exist, none need modification.
- If there were tests, score values would change slightly because Jaro-Winkler produces different scores than `1 - lev/maxLen` for the same strings. Exact fixtures would need recalibration.

**`tests/config/detection-config.test.ts`**: The mock at line 125 references `clusterMode: 'levenshtein'`. This is unrelated (it's a detection config test, not the predictive engine), so no change needed.

### 4.3. Regression safety

- **Re-export guard**: All existing `import { jaroWinkler } from '@/lib/services/entity-detector'` continue to work because the re-export is a passthrough.
- **clusterExact/clusterFuzzy**: Zero-amount guard only excludes near-zero transactions. All existing tests use non-zero amounts (lowest seen: $10), so no existing test is affected.
- **computeDirectionProfile**: Tests mock `bankTransaction.findMany` results. The zero-amount guard only activates when test data includes `amount: 0` or `"0.00"`. No existing test does this.
- **majorityDirection rename**: Tests import `resolveDirection` from entity-enricher. After rename, imports must be updated. This is a compile-time change — TypeScript catches it.
- **checkRoleDirectionMismatch removal**: Tests import this function. Removal causes a compile error. This is intentional — the tests must either be removed or switched to `roleIsValidForDirection`.

---

## 5. Affected Files

| File | Action | Change |
|------|--------|--------|
| `src/lib/utils/string-similarity.ts` | **NEW** | `jaro()` + `jaroWinkler()` from entity-detector |
| `src/lib/services/entity-detector.ts` | MODIFIED | Re-export jaro/jaroWinkler; 2x zero-amount guards; remove directionLockThreshold from config |
| `src/lib/services/entity-classifier.ts` | MODIFIED | Zero-amount guard in computeDirectionProfile loop |
| `src/lib/services/entity-enricher.ts` | MODIFIED | resolveDirection → majorityDirection; remove checkRoleDirectionMismatch; delegate direction validation to roleIsValidForDirection |
| `src/lib/services/direction-filter.ts` | MODIFIED | Export classifyDirection (public API); export DirectionProfile type |
| `src/lib/reconciliation/predictive-engine.ts` | MODIFIED | Remove levenshtein; import jaroWinkler; replace textScore calc |
| `rules/entity-detection.json` | MODIFIED | Remove validation.directionLockThreshold |
| `tests/utils/string-similarity.test.ts` | **NEW** | Unit tests for jaroWinkler edge cases |
| `tests/services/entity-classifier.test.ts` | MODIFIED | Add zero-amount test cases to computeDirectionProfile |
| `tests/services/entity-enricher.test.ts` | MODIFIED | resolveDirection → majorityDirection; remove checkRoleDirectionMismatch tests; update enrichCandidates directionWarning assertions |
| `tests/services/direction-filter.test.ts` | MODIFIED | Add classifyDirection export tests (no logic change) |

**Total**: 1 new file, 7 modified files, 4 test files (1 new + 3 modified).

Files explicitly **NOT** modified (verified no changes needed):
- `src/lib/services/direction-validation.ts` — separate concern (GL class validation)
- `src/lib/services/semantic-validator.ts` — orphaned, not in scope
- `src/lib/utils/decimal.ts` — unrelated
- `src/components/learning/EntityOnboardingModal.tsx` — has its own local `checkRoleDirectionMismatch`, not the service-layer function
- `src/app/api/learning/suggest-role/route.ts` — imports `roleIsValidForDirection`, which is unchanged
- `src/app/api/ai-rules/scan/route.ts` — imports `enrichCandidates` and `buildScanPattern`, unchanged signatures
- `tests/services/entity-detector.test.ts` — re-export preserves behavior; no zero-amount in existing fixtures

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Jaro-Winkler scores differ from Levenshtein** for description matching in predictive engine, causing different match suggestions | Medium | Medium — user sees different reconciliation suggestions | `textScore` remains 0.0–1.0, confidence formula unchanged. Jaro-Winkler is known to be *more accurate* for entity name matching because it rewards prefix matches (common in company names). Risk is non-regression — suggestions change but should improve. Add a note to verify during QA. |
| **Zero-amount filter changes `computeDirectionProfile` results** when entity has zero-amount transactions | Low | Low — correctly excludes noise | Epsilon (0.00001) is safely below minimum currency unit (0.01). Edge case where ALL transactions are zero-amount returns `'any'`, which prevents auto-rule creation — this is correct behavior. |
| **`resolveDirection` → `majorityDirection` breaks callers not identified during analysis** | Low | Medium — compile error | TypeScript will catch any missed import/call during `npx tsc --noEmit`. Only 2 callers exist: internal use in `enrichCandidates()` (line 269) and test imports. Both are in scope. |
| **Remove `checkRoleDirectionMismatch` from enricher changes `directionWarning` format** | Low | Low — UI consuming the warning | The UI component (`EntityOnboardingModal.tsx`) has its *own* `checkRoleDirectionMismatch` (not importing from enricher). The `EnrichedCandidate.directionWarning` field is sourced from `roleIsValidForDirection().reason`, which has a different but equivalent message format. Verify with screenshot tests. |
| **`classifyDirection` export changes public API surface** | Low | Low — new exports are additive | Adding `export` to a previously private function is backward-compatible. No existing code can depend on a private function. |
| **Tests fail because Jaro-Winkler scores differ from expected** | Medium | Medium — CI fail | No existing `predictive-engine.test.ts` found. If tests exist at another path, update expected score values. For all other modules (detector, classifier, enricher, filter), the logic is preserved — tests should pass. |
| **Re-export from entity-detector causes circular dependency** | Low | Low — runtime error | `entity-detector.ts` does not import from `string-similarity.ts` currently. The re-export is a forward-reference — TypeScript resolves it at module evaluation time. No circular path exists. |

**Summary risk profile**: Low. The changes are mechanical (extraction, renaming, guard insertion) with no algorithmic changes to business logic. The highest-risk item is the predictive engine algorithm swap (Levenshtein → Jaro-Winkler), which changes behavior intentionally. Compile-time checks (`tsc --noEmit`) catch all rename/removal issues.
