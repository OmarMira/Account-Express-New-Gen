# Tasks: Consolidate Entity Detection Engines

## Delivery Strategy

- **Strategy**: `auto-chain` — split into chained PRs if estimated lines exceed 400
- **Chain Strategy**: `feature-branch-chain` — child PRs target the previous PR's branch; only the final tracker merges to main
- **Branch prefix**: `consolidate-entity-detection/`

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines | ~460 (net) |
| 400-line budget risk | **High** — split into 2 chained PRs |
| Chained PRs recommended | **Yes** |
| Decision needed before apply | No — chain boundary is clear |

### PR Split

| PR | Tasks | Est. Lines | Risk |
|----|-------|------------|------|
| **PR 1: Foundation + Enricher** | T1, T2, T3, T4, T7, T8 | ~230 (new + modify) | Low — new interfaces + pure functions + tests |
| **PR 2: Scan Route + Integration** | T5, T6, T9 | ~230 (refactor + test) | Medium — scan route output must be type-identical. Rollback: revert route.ts only. |

---

## Task Dependency Graph

```
T1 (ClusterOptions type)
  └── T2 (Exact mode in clusterCandidates) ──┐
                                              ├── T5 (Enricher: core functions)
T3 (normalizePattern for context matching) ───┘      │
                                                      ├── T6 (enrichCandidates pipeline)
T4 (Backward compat verification) ──┐                 │
                                      ├── T7 (Scan route refactor)
                                     T8 (Fix imports/reexports)
```

Tests run in parallel after their subject:
```
T2 ──→ T9 (Exact mode tests)
T6 ──→ T10 (Enricher tests)
T7 ──→ T11 (Scan route regression tests)
```

---

## PR 1: Foundation + Enricher

### T1 — Add `ClusterOptions` interface

**File**: `src/lib/services/entity-detector.ts`

**Action**: Add the `ClusterOptions` interface before `clusterCandidates()`.

```typescript
export interface ClusterOptions {
  mode?: 'fuzzy' | 'exact';
  threshold?: number;
  minOccurrences?: number;
  minLength?: number;
  smartFrequency?: boolean;
  extraNumberStrip?: boolean;
  requireRole?: boolean;
}
```

**Dependencies**: None

**Acceptance criteria**:
- `ClusterOptions` is exported from the module
- All fields are optional (backward compatible)
- Union type `'fuzzy' | 'exact'` is used (extensible for `'hybrid'` later)

**Verification**: `import type { ClusterOptions } from '@/lib/services/entity-detector'` compiles.

---

### T2 — Add `normalizePattern` for context matching (standards alignment)

**File**: `src/lib/services/pattern-normalizer.ts`

**Action** (already exists — verify scope): The `normalizePattern()` function exists. No change needed unless it lacks prefix stripping for context matching.

**Note**: The scan route's inline `normalize()` strips Conf# codes and numbers. The shared `normalizePattern()` does prefix stripping (Zelle, transfer, check, etc.) but NOT Conf#/number removal. These serve different purposes:
- `normalize()` (scan) → key generation for grouping
- `normalizePattern()` (shared) → context matching via `.includes()` (design AD-5)

No change to pattern-normalizer.ts is required. The design's "Adopt normalizePattern" means use it for context matching in the enricher, not for key generation.

**Dependencies**: None

**Acceptance criteria**:
- `normalizePattern()` already handles context matching needs
- No redundant normalization added

**Verification**: Review callers of `normalizePattern()` confirm it's used for `.includes()` matching.

---

### T3 — Implement exact mode in `clusterCandidates()`

**File**: `src/lib/services/entity-detector.ts`

**Action**: Overload/modify `clusterCandidates()` to accept optional `ClusterOptions` as third param.

**Exact mode logic** (`options.mode === 'exact'`):
- Same extraction pipeline (sanitize → extractName)
- Instead of Jaro-Winkler clustering, use normalized key matching:
  ```
  key = extractedName
    .replace(/\b\d[\d.,\/-]*\b/g, '')  // strip numbers (always)
    .replace(/\s{2,}/g, ' ')            // collapse spaces
    .toLowerCase()
    .trim()
  ```
- If `options.extraNumberStrip === true`, apply number stripping BEFORE regex extraction (default `false`)
- Group transactions by exact key match
- Apply `options.minOccurrences` (overrides `config.validation.minOccurrences`) if provided
- Apply `options.minLength` (overrides `config.clustering.minLength`) if provided

**Exact mode summary**:
| Aspect | Fuzzy | Exact |
|--------|-------|-------|
| Match algorithm | Jaro-Winkler >= threshold | Normalized key equality |
| Complexity | O(n × m) on string pairs | O(n) on key hashing |
| Number stripping | None | Always applied to key |
| `extraNumberStrip` | No effect | Strips numbers before extraction |

**Fuzzy mode remains unchanged**: When `options` is omitted or `mode === 'fuzzy'`, behavior is identical to current.

**Backward compatibility**: Existing callers pass 2 args → `options` is `undefined` → default mode `'fuzzy'` → identical behavior.

**Dependencies**: T1 (ClusterOptions type)

**Acceptance criteria**:
- `clusterCandidates(txs, config)` (2 args) returns same results as before
- `clusterCandidates(txs, config, { mode: 'exact' })` groups by normalized key, not Jaro-Winkler
- Exact mode correctly handles: number stripping, minOccurrences override, minLength override
- `extraNumberStrip` correctly strips numbers before extraction when `true`
- `smartFrequency` flag is accepted but NOT implemented here (deferred to enricher)

**Verification**: Unit tests in T9.

---

### T4 — Verify backward compatibility

**File**: `src/lib/services/entity-detector.ts`

**Action**: Confirm all existing callers of `clusterCandidates()` still compile and produce identical results.

**Search for callers**:
- `entity-detector.test.ts` — 2 calls, both pass 2 args ✅
- `scan/route.ts` — currently calls inline normalize+count, NOT `clusterCandidates`. After refactor (T7), will call with `{ mode: 'exact' }`.
- Any other callers via grep.

**Dependencies**: T3

**Acceptance criteria**:
- No TypeScript errors from existing 2-arg calls
- No behavioral change for existing callers

**Verification**: `npx tsc --noEmit` passes; existing tests pass.

---

### T5 — Create `entity-enricher.ts`: core pure functions

**File**: `src/lib/services/entity-enricher.ts` (new)

**Action**: Create module with these exported pure functions.

#### 5a — `resolveContextRole(candidate, description, input)`

**Input**:
- `candidate: EntityCandidate`
- `description: string` — raw transaction sample
- `input: EnrichmentInput` — includes `contexts: EntityContextWithGlAccount[]`, `rolePriorities`

**Logic**:
1. Normalize `description` via `normalizePattern()` from pattern-normalizer
2. Filter contexts where `normalizedDesc.includes(ctx.pattern.toLowerCase())` OR candidate name includes ctx pattern
3. If exactly 1 match → return it
4. If multiple matches → sort by `rolePriorities[role]` (lower = higher priority)
5. If SOCIO conflict detected (via `entityFirstCheck`) → exclude SOCIO contexts

**Returns**: `EntityContextWithGlAccount | null`

#### 5b — `suggestGlAccount(context, isDebit, glAccounts)`

**Input**:
- `context: EntityContextWithGlAccount | null`
- `isDebit: boolean`
- `glAccounts: GlAccount[]`

**Logic**:
1. If context has a linked `glAccount` → return it
2. If context has a role → look up `ROLE_ACCOUNT_MAP[role]`, resolve debit/credit code → find matching GL account
3. If all fail → return `null`

#### 5c — `resolveDirection(candidate)`

**Input**: `candidate: EntityCandidate`

**Logic**:
- Return `'debit'` if `debitPct > 0.5`
- Return `'credit'` if `creditPct > 0.5`
- Return `null` if ambiguous

#### 5d — `buildScanPattern(enriched, entityKey, entry)` (scan-specific mapping)

**Input**: Enriched candidate + original entry data

**Logic**: Map from `EnrichedCandidate` fields to `ScanPattern` shape:
```typescript
{
  id: base64(entityKey),
  description: entityKey,
  rawDescription: entry.sample,
  occurrences: entry.count,
  direction: isDebit ? 'debit' : 'credit',
  averageAmount: entry.totalAmount / entry.count,
  suggestedAccount: suggested?.name ?? '',
  suggestedAccountCode: suggested?.code ?? '',
  suggestedAccountId: suggested?.id ?? '',
  hasContext: enriched.hasContext,
  contextRole: enriched.contextRole,
}
```

**Dependencies**: T3 (EntityCandidate type with enrichment fields)

**Acceptance criteria**:
- All functions are pure (no side effects, no DB calls)
- `resolveContextRole` returns correct context from normalizePattern matching
- `resolveContextRole` handles SOCIO conflict via `entityFirstCheck`
- `suggestGlAccount` follows priority: context.glAccount → ROLE_ACCOUNT_MAP → null
- `resolveDirection` returns based on directionProfile thresholds
- `buildScanPattern` produces identical shape to current `ScanPattern` interface

**Verification**: Unit tests in T10.

---

### T6 — Create `enrichCandidates()` pipeline function

**File**: `src/lib/services/entity-enricher.ts`

**Action**: Add the `enrichCandidates()` pipeline function that orchestrates T5a–T5d per candidate.

```typescript
export function enrichCandidates(
  candidates: EntityCandidate[],
  descriptions: Map<string, string>,  // entityKey → raw sample description
  input: EnrichmentInput,
  options?: { requireRole?: boolean; smartFrequency?: boolean },
): EnrichedCandidate[];
```

**Logic per candidate**:
1. `resolveContextRole(candidate, descriptions.get(entityKey), input)` → context
2. Apply `smartFrequency` filter: if context, minOccurrences = 1, else = options override or config default
3. Apply `requireRole` filter: if `true`, skip candidates without a resolved context
4. `suggestGlAccount(context, isDebit, glAccounts)` → suggested account
5. `resolveDirection(candidate)` → direction
6. Skip if an existing rule already covers this pattern (via `skipExistingRule` check)
7. Return enriched candidate object

**EnrichedCandidate type** (add to same file):
```typescript
export interface EnrichedCandidate extends EntityCandidate {
  hasContext: boolean;
  contextRole: string;
  suggestedAccountName: string;
  suggestedAccountCode: string;
  suggestedAccountId: string;
}
```

**Dependencies**: T5

**Acceptance criteria**:
- Empty candidates → empty result
- Candidates with context → enriched with account + role
- `requireRole: true` filters out contextless candidates
- `smartFrequency: true` adjusts minOccurrences threshold
- Each candidate enriched exactly once (no per-tx duplication)
- `skipExistingRule` prevents suggesting patterns already in active rules

**Verification**: Unit tests in T10.

---

## PR 2: Scan Route Refactor + Integration

### T7 — Refactor scan route to use unified engine + enricher

**File**: `src/app/api/ai-rules/scan/route.ts`

**Action**: Strip inline enrichment logic; replace with calls to unified engine + enricher.

#### Current code to remove:
- Lines 53–60: inline `normalize()` function
- Lines 62–69: internal `Entry` interface
- Lines 71–107: inline normalize+count loop → replace with `clusterCandidates(mode:'exact', extraNumberStrip:true)`
- Lines 123–169: inline `suggestAccount()` function
- Lines 192–311: inline context matching, role resolution, account suggestion, ScanPattern building

#### New code:
```typescript
import { loadConfig, clusterCandidates } from '@/lib/services/entity-detector';
import { enrichCandidates, buildScanPattern } from '@/lib/services/entity-enricher';

export const POST = apiHandler(async (request, context) => {
  const { companyId } = requireCompanyContext();

  // 1. Fetch data (same as before): bankAccounts, transactions, glAccounts, contexts, existingRules
  // ...

  // 2. Run unified engine
  const config = loadConfig();
  const candidates = clusterCandidates(transactions, config, {
    mode: 'exact',
    extraNumberStrip: true,
  });

  // 3. Build descriptions map (entityKey → raw sample)
  const descriptions = new Map<string, string>();
  for (const c of candidates) {
    descriptions.set(c.canonicalName.toLowerCase(), c.sampleDescriptions[0] ?? '');
  }

  // 4. Enrich
  const enriched = enrichCandidates(candidates, descriptions, {
    contexts,
    glAccounts,
    rolePriorities: await loadRolePriorities(),
    knownSocioPatterns,
  }, {
    requireRole: true,
    smartFrequency: true,
  });

  // 5. Map to ScanPattern[]
  const patterns = enriched
    .filter(e => e.hasContext)  // same as current "if (!context) continue"
    .map(e => buildScanPattern(e, entityKey, entry));

  // 6. Sort
  patterns.sort((a, b) => b.occurrences - a.occurrences);

  return NextResponse.json({ patterns });
});
```

**Critical constraint**: The output `ScanPattern` interface must remain IDENTICAL to the current one:
```typescript
interface ScanPattern {
  id: string;
  description: string;
  rawDescription: string;
  occurrences: number;
  direction: string;
  averageAmount: number;
  suggestedAccount: string;
  suggestedAccountCode: string;
  suggestedAccountId: string;
  hasContext: boolean;
  contextRole: string;
}
```

**Dependencies**: T6 (enrichCandidates pipeline)

**Acceptance criteria**:
- All inline enrichment logic removed from route.ts
- Route calls `clusterCandidates(mode:'exact')` + `enrichCandidates()`
- `ScanPattern` output shape is type-identical to before (verified by TS interface check)
- Same input data produces same output patterns (verified by integration test)
- SOCIO conflict detection via `entityFirstCheck` preserved (kept in enricher's `resolveContextRole`)
- No new DB queries added, no existing queries removed

**Verification**: Integration test in T11 + manual diff of JSON response shape.

---

### T8 — Fix imports and re-exports

**File**: Various

**Action**: Ensure all modules export/import correctly after refactor.

- `entity-enricher.ts` exports: `resolveContextRole`, `suggestGlAccount`, `resolveDirection`, `enrichCandidates`, `buildScanPattern`, `EnrichedCandidate`, `EnrichmentInput`
- `entity-detector.ts` exports: add `ClusterOptions`
- `scan/route.ts` imports: update to pull from new locations

**Dependencies**: T7

**Acceptance criteria**:
- `npx tsc --noEmit` passes with zero errors
- No circular dependencies introduced
- All type imports use `import type` where applicable

**Verification**: TypeScript compilation.

---

## Tests (PR 1 + PR 2)

### T9 — Add exact mode tests to entity-detector.test.ts

**File**: `tests/services/entity-detector.test.ts`

**New test groups**:

#### `clusterCandidates — exact mode`
- **Same tx sets as fuzzy** but expects exact key grouping
- Test: `mode: 'exact'` groups "7-ELEVEN" and "7-ELEVEN " (different whitespace) as same key after normalization
- Test: `mode: 'exact'` with `minOccurrences: 2` filters out single-occurrence entities
- Test: `mode: 'exact'` with `extraNumberStrip: true` strips numbers before extraction, catching cases like "7-ELEVEN" → "ELEVEN" vs "7-ELEVEN" → fallback

#### `clusterCandidates — backward compatibility`
- Test: `clusterCandidates(txs, config)` (no options) produces same Jaro-Winkler fuzzy results as before
- Test: `clusterCandidates(txs, config, {})` (empty options) defaults to fuzzy

#### `clusterCandidates — exact mode real tx sets`
- ≥5 real transaction sets from proposal data
- Compare exact mode output against current scan route output for same inputs

**Dependencies**: T3

**Acceptance criteria**:
- All existing fuzzy tests still pass (no regression)
- New exact mode tests pass
- At least 3 test cases per behavioral aspect

**Verification**: `npx vitest run tests/services/entity-detector.test.ts`.

---

### T10 — Create entity-enricher.test.ts

**File**: `tests/services/entity-enricher.test.ts` (new)

**Test groups**:

#### `resolveContextRole`
- Context match via `normalizePattern().includes()` — description "Zelle payment to ACME CORP" matches context pattern "acme corp"
- Multiple context match: correct role priority wins
- No context match: returns null
- SOCIO conflict: `entityFirstCheck` excludes SOCIO contexts when merchant is present

#### `suggestGlAccount`
- Context has linked glAccount → returns it
- Context without glAccount but role → resolves via ROLE_ACCOUNT_MAP (debit and credit cases)
- No context and no role → returns null
- Fallback heuristic (no longer in scan route — now in `suggestGlAccount` as final fallback or removed)

#### `resolveDirection`
- Candidate with debit > 50% → `'debit'`
- Candidate with credit > 50% → `'credit'`
- Ambiguous (50/50) → `null`

#### `enrichCandidates`
- Empty input → empty output
- Single candidate with complete context → fully enriched
- `requireRole: true` filters out contextless
- `smartFrequency: true` adjusts minOccurrences
- Skip existing rule
- Per-candidate deduplication (same candidate from multiple txs enriched once)

**Dependencies**: T6

**Acceptance criteria**:
- All enricher functions have ≥80% line coverage
- Tests use Vitest with no external HTTP dependencies
- Edge cases covered: null inputs, empty arrays, missing role, SOCIO conflict

**Verification**: `npx vitest run tests/services/entity-enricher.test.ts`.

---

### T11 — Create scan-route.test.ts (integration)

**File**: `tests/services/scan-route.test.ts` (new)

**Test groups**:

#### ScanPattern output shape
- Mock DB (bankAccounts, transactions, glAccounts, entityContexts, existingRules)
- Call POST handler
- Assert response has `{ patterns: ScanPattern[] }`
- Assert each pattern has ALL 11 fields (id, description, rawDescription, occurrences, direction, averageAmount, suggestedAccount, suggestedAccountCode, suggestedAccountId, hasContext, contextRole)
- Assert field types match current production schema

#### Regression: same output as current scan
- Feed same mock data to old logic (keep a reference copy)
- Feed to new refactored handler
- Assert output lists match (same patterns, same sorting, same counts)
- Small tolerance for `id` field change (Base64 vs hash — ensure consistent)

#### Edge cases
- Empty transactions → `{ patterns: [] }`
- No bank accounts → `{ patterns: [] }`
- All transactions already ruled/classified → empty result
- Single occurrence entities → filtered (minOccurrences)
- Context-less transactions → filtered (requireRole)

**Dependencies**: T7

**Acceptance criteria**:
- At least 5 test cases covering happy path, empty, edge, and regression
- Tests mock DB only — no real database or HTTP calls
- Tests verify ScanPattern shape is type-identical to current

**Verification**: `npx vitest run tests/services/scan-route.test.ts`.

---

## Non-Functional Requirements

| Requirement | Check |
|------------|-------|
| No DB schema changes | ✅ All changes are service-layer |
| No new dependencies | ✅ Vitest already used |
| No env/config changes | ✅ |
| TypeScript strict mode | ✅ All new code typed, no `any` |
| Backward compatible API | ✅ Scan route URL + response shape unchanged |
| Deployable in steps | ✅ Each PR independently deployable |

## Rollback Order

1. Revert PR 2: `git revert scan/route.ts`, `git revert scan-route.test.ts`
2. Revert PR 1: `git revert entity-enricher.ts`, `git revert entity-detector.ts`, `git revert test files`
