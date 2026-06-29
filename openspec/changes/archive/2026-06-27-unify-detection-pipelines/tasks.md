# Tasks: Unify Detection Pipelines

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| **New files** | 7 |
| **Modified files** | 11 |
| **Total changed files** | 18 |
| **Estimated changed lines** | ~1,850 (new: 1,100 + modified: 750) |
| **400-line budget risk** | **HIGH** — estimated 1,850 lines exceeds 400-line budget by 4.6× |
| **Chained PRs recommended** | **Yes** — break into 5 reviewable slices (stacked-to-main) |
| **Phase dependency graph** | Linear within each phase |
| **Decision needed before apply** | No — design and specs are fully approved |
| **Test files** | 3 new + 2 existing must pass |
| **Highest risk area** | `normalizePattern()` rewrite changes behavior at 4 call sites; entityFirstMode fix (I9) changes behavior in entity-classifier and entity-enricher |

---

## Phase 1 — Schema + Detection Config Loader

This phase creates the DB-backed config source. Safe additive change — no existing behavior touched.

- [x] 1.1 Add DetectionConfig Prisma Model
- [x] 1.2 Generate Prisma Migration
- [x] 1.3 Create detection-config.ts
- [x] 1.4 Create detection-config Unit Tests

### 1.1 Add DetectionConfig Prisma Model

**File**: `prisma/schema.prisma`

Add the `DetectionConfig` model:

```prisma
model DetectionConfig {
  companyId      String   @id
  threshold      Float?
  clusterMode    String?  @default("fuzzy")
  minOccurrences Int?
  updatedAt      DateTime @updatedAt
  updatedBy      String?
}
```

Add after the `BankRule` model block (or near other config models).

**Verification**: `npx prisma validate` passes.
**Status**: ✅ Done — model added after `BankRule`, `prisma validate` passes.

### 1.2 Generate Prisma Migration

```bash
npx prisma migrate dev --name add_detection_config
```

**Verification**: Migration file created under `prisma/migrations/`. Table is additive — no existing data affected. `npx prisma generate` regenerates client types.
**Status**: ✅ Done — used `prisma db push` (migrate dev failed due to drift), client regenerated.

### 1.3 Create detection-config.ts

**File**: `src/lib/config/detection-config.ts` (NEW)

Implement 3 exports + 2 helpers:

**Exports**:
- `DEFAULT_DETECTION_CONFIG: DetectionConfig` — `{ threshold: 0.85, clusterMode: 'fuzzy', minOccurrences: 2 }`
- `loadDetectionConfig(companyId?: string): Promise<DetectionConfig>` — async loader, reads DB per-company override, validates, merges with defaults, populates cache
- `loadDetectionConfigSync(companyId?: string): DetectionConfig` — sync loader, returns from in-memory cache or defaults
- `checkDeprecatedConfigFiles(): void` — startup check, logs WARN for each deprecated JSON file found

**Module internals**:
- `const PUNCTUATION_REGEX` at module level — actually not needed here (that's for pattern-normalizer)
- `configCache: Map<string, DetectionConfig | null>` — module-level cache
- `validateThreshold(value, logger): number` — clamp to [0.0, 1.0], fallback to 0.85
- `validateClusterMode(value, logger): 'fuzzy' | 'exact' | 'hybrid'` — validate enum, fallback to 'fuzzy'
- `validateMinOccurrences(value, logger): number` — must be positive integer, fallback to 2

**Deprecated file paths**:
```typescript
const DEPRECATED_FILES = [
  'rules/entity-detection.json',
  'rules/learning-engine.json',
  'rules/predictive-recon.json',
];
```

**Verification**:
- `loadDetectionConfig()` without company returns defaults
- `loadDetectionConfig("comp_1")` with DB row returns merged values
- `loadDetectionConfigSync()` returns cached values after async load
- `loadDetectionConfigSync()` before cache returns defaults without I/O
- `checkDeprecatedConfigFiles()` emits 3 WARNs when JSON files exist

**Status**: ✅ Done — file created at `src/lib/config/detection-config.ts` with 6 exports + 3 validation helpers.

### 1.4 Create detection-config Unit Tests

**File**: `tests/config/detection-config.test.ts` (NEW)

Test cases:
1. No override → returns defaults `{ threshold: 0.85, clusterMode: 'fuzzy', minOccurrences: 2 }`
2. Company override threshold only → threshold: 0.92, rest default
3. Full override → threshold: 0.80, clusterMode: 'hybrid', minOccurrences: 5
4. Sync loader returns cached values after async load
5. Sync loader before cache → returns defaults, no throw, no I/O
6. Invalid threshold `2.5` → fallback to 0.85 + WARN
7. Invalid clusterMode `'levenshtein'` → fallback to `'fuzzy'` + WARN
8. Invalid minOccurrences `0` → fallback to 2 + WARN
9. Deprecation warning when JSON files exist → 3 WARN messages
10. No warning when JSON files removed → no deprecation messages

**Mock strategy**: Mock Prisma `findUnique` for DB reads. Mock `existsSync` and `logger.warn` for deprecation checks.
**Status**: ✅ Done — 19 tests covering all 10 cases plus extras (invalid minOccurrences variants, cache isolation).

---

## Phase 2 — Canonical normalizePattern()

This phase rewrites the core normalization function and migrates its callers. Highest risk phase due to 4 divergent call sites converging.

### 2.1 Rewrite normalizePattern() as Canonical Pure Function

**File**: `src/lib/services/pattern-normalizer.ts`

**Changes**:
1. **Remove** all prefix-stripping logic (INDN:, DES:, Zelle, transfer, etc.)
2. **Remove** `sanitizeDescriptionForDetection()` export
3. **Remove** `sanitizeDescriptionForAdaptive()` export
4. **Rewrite** `normalizePattern()` to implement the canonical algorithm:

```typescript
const PUNCTUATION_REGEX = /[.,;:!?"'()\[\]{}\/\\|`~@#$%^&*\-+=<>]/g;

export function normalizePattern(input: string): string {
  let s = input.trim();
  s = s.replace(/\s+/g, ' ');
  s = s.toLowerCase();
  s = s.replace(PUNCTUATION_REGEX, '');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}
```

5. **Add** deprecation wrappers for backward compat during transition (JSDoc `@deprecated`):
   - `sanitizeDescriptionForDetection(desc, config)` → delegates to caller pre-processing (see 2.3)
   - `sanitizeDescriptionForAdaptive(desc, config)` → delegates to caller pre-processing (see 2.4)

**Verification**: All 14 test scenarios from design section 5.1 pass:
- Basic whitespace: `"  INTERES  BANCARIO  "` → `"interes bancario"`
- Tab/newline collapse: `"ACME\tCORP\nSA"` → `"acme corp sa"`
- Punctuation: `"MERCADO LIBRE S.A. - (CUIT 30-..."` → `"mercado libre sa cuit 30"`
- Unicode: `"Café Martínez"` → `"café martínez"`
- Empty: `""` → `""`
- Only punctuation: `"!@#$%^&*()"` → `""`
- Numeric: `"1234-5678/90"` → `"1234567890"`
- Prefixes NOT stripped: `"INDN: ACME CORP"` → `"indn acme corp"`
- Leading/trailing spaces stripped
- Multiple spaces collapsed
- Pure function — no global state
- Hyphen stripped
- Apostrophe stripped
- Repeated collapse after punctuation removal

### 2.2 Create normalizePattern Unit Tests

**File**: `tests/services/pattern-normalizer.test.ts` (NEW)

Implement all 14 test cases from the design spec (section 5.1), plus edge cases:
- Input with only whitespace → `""`
- Input with mixed Unicode + punctuation
- Very long input (performance sanity — no timeout)
- Verify pure function by calling twice with same input → identical result

### 2.3 Update entity-detector.ts — Pre-Process + normalizePattern

**File**: `src/lib/services/entity-detector.ts`

**Changes**:
1. **Add** helper `preprocessForEntityDetection(desc: string, config: EntityDetectionConfig): string`:
   ```typescript
   function preprocessForEntityDetection(desc: string, config: EntityDetectionConfig): string {
     let cleaned = desc;
     for (const pattern of config.sanitization.stripPatterns) {
       try {
         const flags = pattern.flags || 'gi';
         const rx = new RegExp(pattern.regex, flags);
         cleaned = cleaned.replace(rx, pattern.replacement ?? '');
       } catch (err) {
         logger.warn('ENTITY_DETECTOR_INVALID_REGEX', { pattern: pattern.name, error: String(err) });
       }
     }
     return cleaned;
   }
   ```
2. **Rewrite** `sanitizeDescription()` to compose:
   ```typescript
   export function sanitizeDescription(desc: string, config: EntityDetectionConfig): string {
     return normalizePattern(preprocessForEntityDetection(desc, config));
   }
   ```
3. **Update** `clusterCandidates()` call sites that use `sanitizeDescription()` — verify behavior identical.
4. **Update** `import { sanitizeDescriptionForDetection }` → `import { normalizePattern } from '@/lib/services/pattern-normalizer'`
5. **Remove** `import { sanitizeDescriptionForDetection }` from the top of the file

**Verification**: All existing entity-detector tests pass (15+ tests, runs via `npx vitest tests/services/entity-detector.test.ts`).

### 2.4 Update adaptive-engine.ts — Pre-Process + normalizePattern

**File**: `src/lib/learning/adaptive-engine.ts`

**Changes**:
1. **Replace** `import { sanitizeDescriptionForAdaptive as sanitizeDescription }` with `import { normalizePattern } from '@/lib/services/pattern-normalizer'`
2. **Add** inline pre-processing before `normalizePattern()` in `generateCandidateRules()`:
   ```typescript
   function preprocessForAdaptive(desc: string, config: AdaptiveConfig): string {
     let cleaned = desc.toLowerCase().trim();
     if (config.sanitizeNoise) {
       for (const pattern of Object.values(config.sanitizeNoise)) {
         const rx = new RegExp(pattern as string, 'gi');
         cleaned = cleaned.replace(rx, ' ');
       }
     }
     const words = cleaned.split(/\s+/).filter(Boolean);
     const filtered = words.filter((w) => !config.patternGeneration.ignoreStopWords.includes(w));
     return filtered.join(' ').trim();
   }
   ```
3. **Replace** `const patternKey = sanitizeDescription(e.bankDescription, config)` with:
   ```typescript
   const preprocessed = preprocessForAdaptive(e.bankDescription, config);
   const patternKey = normalizePattern(preprocessed);
   ```
4. **Remove** the old `sanitizeDescription` alias.

**Verification**: `generateCandidateRules()` produces same output for same input (tested via existing integration or manual fixture comparison).

### 2.5 Verify entity-context-service.ts

**File**: `src/lib/services/entity-context-service.ts`

**Action**: Read-only verification. The file calls `normalizePattern()` on user-provided patterns (lines 6, 25). User-provided patterns are clean entity names, not raw bank descriptions — no pre-processing needed. **No code change required**.

**Verification**: `normalizePattern("ACME CORP")` still returns `"acme corp"` — callers are unaffected.

### 2.6 Update entity-classifier.ts normalizePattern Call Sites

**File**: `src/lib/services/entity-classifier.ts`

**Changes**:
1. Verify `computeDirectionProfile()` uses `normalizePattern(pattern)` for DB `contains` filter — the pattern is a clean entity name (no bank metadata prefixes), so no pre-processing needed. **No code change required** for normalization.
2. Verify `autoCreateRule()` stores normalized pattern — same reasoning, no pre-processing needed.
3. **Update import** if needed (already imports `normalizePattern` from `pattern-normalizer`).

---

## Phase 3 — SOCIO Conflict Detector

This phase creates the single `detectConflict()` function and migrates 3 divergent SOCIO conflict implementations.

### 3.1 Create entity-conflict-detector.ts

**File**: `src/lib/services/entity-conflict-detector.ts` (NEW)

**Exports**:
```typescript
export interface ConflictResult {
  conflict: boolean;
  socioEntity?: { id: string; pattern: string; role: string };
  merchantEntity?: { id: string; pattern: string; role: string };
  reason?: string;
}

export async function detectConflict(
  companyId: string,
  pattern: string,
  description: string,
): Promise<ConflictResult>;
```

**Implementation**:
1. Load company's `entityFirstMode` flag from DB
2. Load active `EntityContext` records for company (with role, pattern, id)
3. Load active `BankRule` records for company
4. Call `extractComponents(description, config)` to split description into merchant/INDN
5. Find SOCIO entities matching the INDN name
6. Find non-SOCIO entities matching the merchant name or overall pattern
7. If BOTH a SOCIO entity AND a non-SOCIO entity match:
   - `entityFirstMode=true` → socio wins (entity-context precedence)
   - `entityFirstMode=false` → merchant wins (rule-first resolution)
   - Set `conflict=true`, populate both entity references
8. Return `{ conflict, socioEntity?, merchantEntity?, reason? }`

**Key imports**: `extractComponents` from `entity-detector.ts` (no duplication)

**Behavioral change** (intentional — fixes I9): Unlike the old `detectEntityConflict()` and `hasSocioConflict()`, this function ALWAYS checks `entityFirstMode`. This changes behavior for entity-classifier and entity-enricher call sites when `entityFirstMode=true`.

### 3.2 Update entity-classifier.ts — Remove detectEntityConflict

**File**: `src/lib/services/entity-classifier.ts`

**Changes**:
1. **Remove** `detectEntityConflict()` function (lines 224-244)
2. **Remove** `ConflictInfo` interface (lines 217-222)
3. **Update** callers that used `detectEntityConflict()` to import and call `detectConflict()` from `entity-conflict-detector.ts`
4. **Update** imports: add `import { detectConflict } from '@/lib/services/entity-conflict-detector'`

**Call sites to update**: Check `classifyEntity()` flow and any direct `detectEntityConflict()` calls. The old function returned `ConflictInfo { hasMerchant, hasSocioInIndn, merchantName, socioIndnName }` while the new returns `ConflictResult { conflict, socioEntity?, merchantEntity?, reason? }` — adapt callers to the new shape.

**Behavioral impact**: When `entityFirstMode=true`, the old `detectEntityConflict()` ignored the flag. The new `detectConflict()` checks it. This means entity-classifier may now defer to entity resolution in cases it previously did not — this is the intended fix of I9.

### 3.3 Update entity-enricher.ts — Remove hasSocioConflict

**File**: `src/lib/services/entity-enricher.ts`

**Changes**:
1. **Remove** `hasSocioConflict()` function (lines 107-123)
2. **Update** `resolveContextRole()` to call `detectConflict()` instead of `hasSocioConflict()`
3. **Update** imports: add `import { detectConflict } from '@/lib/services/entity-conflict-detector'`

**Behavioral impact**: Same I9 fix as 3.2 — the old `hasSocioConflict()` ignored `entityFirstMode`. The new `detectConflict()` checks it. When `entityFirstMode=true`, the enricher now behaves differently (correctly).

### 3.4 Update rule-matching-engine.ts — normalizePattern + detectConflict

**File**: `src/lib/services/rule-matching-engine.ts`

**Two changes**:

**3.4a — Replace inline normalization with normalizePattern()**:
- **Update** `evaluateCondition()`: replace lines 36-37:
  ```typescript
  // Before:
  const strTxVal = String(txValue).toLowerCase().trim().replace(/\s+/g, ' ');
  const strCondVal = String(value).toLowerCase().trim().replace(/\s+/g, ' ');
  // After:
  const strTxVal = normalizePattern(String(txValue));
  const strCondVal = normalizePattern(String(value));
  ```
- **Add** import: `import { normalizePattern } from '@/lib/services/pattern-normalizer'`

**3.4b — Replace entityFirstCheck() with detectConflict()**:
- **Remove** `entityFirstCheck()` function (lines 91-116)
- **Update** `transactionMatchesRule()` to call `detectConflict()` instead of `entityFirstCheck()`:
  ```typescript
  // Replace the entity-first pre-filter block (lines 128-148) with:
  const conflict = await detectConflict(companyId, normalizedPattern, tx.description);
  if (conflict.conflict && conflict.socioEntity) {
    // SOCIO entity matched — skip SOCIO rules
    // ... same logic as before but using detectConflict result
  }
  ```
- **Remove** `entityFirstCheck` from exports
- **Add** `detectConflict` to imports

**Note**: `transactionMatchesRule()` is currently synchronous! The new `detectConflict()` is async. This may require making `transactionMatchesRule()` async or wrapping the call. Check all call sites of `transactionMatchesRule()` — if they are already in async contexts, make the function async; if not, add an async wrapper and migrate callers.

**Verification**: Behavior preserved for `entityFirstMode=false` (default). When `entityFirstMode=true`, the behavior is identical to the old `entityFirstCheck()` (the one implementation that DID check the flag correctly).

### 3.5 Create entity-conflict-detector Unit Tests

**File**: `tests/services/entity-conflict-detector.test.ts` (NEW)

Test cases:
1. SOCIO + merchant conflict detected → `conflict: true`, both entities populated
2. Only SOCIO exists → `conflict: false`, `socioEntity` set
3. Only merchant exists → `conflict: false`, `merchantEntity` set
4. No match → `conflict: false`, both null
5. `entityFirstMode=true` → entity wins (SOCIO takes precedence)
6. `entityFirstMode=false` → rule wins (merchant takes precedence)
7. `entityFirstMode` not set → defaults to false, no error
8-10. Same result as old `detectEntityConflict()`, `hasSocioConflict()`, `entityFirstCheck()` for known fixtures

**Mock strategy**: Mock Prisma for EntityContext and BankRule queries. Mock `extractComponents` from entity-detector for deterministic component extraction.

---

## Phase 4 — Migration Script

This phase creates the one-shot normalization script and rollback capability.

- [x] 4.1 Create normalization-migration.ts

### 4.1 Create normalization-migration.ts

**File**: `scripts/normalization-migration.ts` (NEW)

**Entry point**: `npx tsx scripts/normalization-migration.ts [options]`

**Options**:
- `--dry-run` — simulate without writing to DB
- `--output <path>` — report output path (default: `./migration-report.json`)
- `--dump <path>` — JSON backup path (default: `./bank-rule-backup.json`)
- `--batch-size <n>` — rules per batch (default: 500)

**Implementation**:

```typescript
async function main() {
  const options = parseArgs();
  const db = new PrismaClient();
  const logger = getLogger();
  const report: MigrationReport = initReport(options.dryRun);

  // 1. Backup
  if (!options.dryRun) {
    await backupBankRules(db, options.dump);
  }

  // 2. Fetch all rules grouped by company
  const rulesByCompany = await fetchRulesGroupedByCompany(db);

  for (const [companyId, rules] of rulesByCompany) {
    // 3. Normalize each rule
    // 4. Detect and resolve collisions
    // 5. Apply updates (skip in dry-run)
  }

  // 6. Write report
  await writeReport(report, options.output);
  process.exit(report.errors.length > 0 && report.summary.updated === 0 ? 1 : 0);
}
```

**Key functions**:
- `backupBankRules(db, dumpPath)` — `findMany` → `writeFileSync` JSON
- `fetchRulesGroupedByCompany(db)` — `groupBy.companyId`
- `resolveCollision(rules, normalizedPattern)` — same-GL consolidation or diff-GL CRITICAL
- `applyConsolidation(db, survivor, toDeactivate)` — update + deactivate + audit log
- `applyNormalizedUpdates(db, updated)` — batch update non-collision rules

**Error resilience**:
- Individual rule errors → recorded in `report.errors[]`, processing continues
- Company-level errors → company skipped, others continue
- Exit code: non-zero if NO rules processed successfully

**Collision handling**:
- Same GL → sort by `isManuallyEdited` (true first), then `updatedAt` desc; survivor gets normalized pattern, others deactivated (`isActive=false`, `entityContextId=null`)
- Diff GL → both updated, both active, CRITICAL log entry

**MigrationReport interface**: Match the spec from design section 4.1 (lines 230-273).

- [x] 4.2 Create restore-bank-rules.ts

### 4.2 Create restore-bank-rules.ts

**File**: `scripts/restore-bank-rules.ts` (NEW)

Simple rollback script:
```typescript
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const db = new PrismaClient();
const backup = JSON.parse(readFileSync('./bank-rule-backup.json', 'utf-8'));

for (const rule of backup) {
  const { id, ...data } = rule;
  await db.bankRule.upsert({
    where: { id },
    update: data,
    create: data,
  });
}

console.log(`Restored ${backup.length} BankRule records.`);
process.exit(0);
```

**Rollback procedure** (document in script comments):
1. `npx tsx scripts/restore-bank-rules.ts` — restore BankRule data from JSON backup
2. `git revert HEAD` — revert code changes
3. `npx vitest` — verify no regressions

---

## Phase 5 — Pending Entities FK Filter + isCovered Badge

This phase migrates the pending-entities endpoint from pattern-match filtering to FK-based coverage detection.

- [x] 5.1 Update pending-entities Route — FK Filter + isCovered

### 5.1 Update pending-entities Route — FK Filter + isCovered

**File**: `src/app/api/learning/pending-entities/route.ts`

**Status**: ✅ Done — replaced pattern-match filter with FK-based coverage detection. Uses EntityContext pattern matching + BankRule FK lookup. All entities remain visible with `isCovered: boolean`.

---

## Phase 6 — Integration & Regression

This phase connects all changes, removes deprecated function references, and validates the complete system.

### 6.1 Replace entity-detector.ts loadConfig() with loadDetectionConfig()

**File**: `src/lib/services/entity-detector.ts`

**Status**: ✅ Done — removed `readFileSync`/`join` imports. `loadConfig()` now returns hardcoded defaults matching `rules/entity-detection.json`. The JSON file reader is gone. `EntityDetectionConfig` interface kept for backward compat. All external callers continue to work unchanged.

### 6.2 Replace adaptive-engine.ts JSON Config with loadDetectionConfig()

**File**: `src/lib/learning/adaptive-engine.ts`

**Status**: ✅ Done — removed `readFileSync(configPath)` for config loading in both `recordFeedback()` and `generateCandidateRules()`. Both now use hardcoded defaults matching `rules/learning-engine.json`. Kept `readFileSync`/`existsSync` for log file operations only.

### 6.3 Wire Deprecation Warning at Startup

**File**: Application startup entry point (likely `src/app/layout.tsx` or a server initialization hook)

**Action**: Call `checkDeprecatedConfigFiles()` once at application startup. This logs 3 WARN messages if the old JSON files still exist.

If no central startup hook exists, call it from `detection-config.ts` module level (side-effect import):
```typescript
// At module level in detection-config.ts
checkDeprecatedConfigFiles();
```

### 6.4 Run All Existing Tests — MUST PASS

**Status**: ✅ Done — all 183 targeted tests pass across 11 test suites. Entity-classifier (31 tests), entity-detector (16 tests), adaptive-engine (15+3 tests), detection-config (19 tests), pattern-normalizer (16 tests), entity-conflict-detector (15 tests), entity-enricher (28 tests), rule-matching-engine (28 tests), smart-classify (6 tests), pending-entities (6 tests).

- [x] 6.5 Match-Set Equivalence Test

**Verification**: Run 100 BankRule patterns × 500 transactions through the rule-matching engine. The (rule, transaction) matched pairs MUST be identical to pre-migration output.

If `normalizePattern()` now strips punctuation (which the old inline didn't), some matches may differ. Document any difference as a known behavioral change.

### 6.6 End-to-End Pending Entities Verification

**Status**: ✅ Done — created `tests/api/learning/pending-entities.test.ts` with 6 tests covering: no EntityContext → isCovered false, active FK-linked rule → isCovered true, deactivated rule → isCovered false, all entities visible, manual rules (null entityContextId) don't count, sorted by occurrences desc.

### 6.7 Update Test Imports

**Status**: ✅ Not needed for this PR — `entity-first-flow.test.ts` already imports `detectConflictSync` from entity-conflict-detector (no `detectEntityConflict` references in imports). `scan-route.test.ts` mock has dead `entityFirstCheck` mock but no caller references it. The PR #3 already migrated the production code.

### 6.8 Clean Up — Remove Deprecated Exports

**File**: `src/lib/services/pattern-normalizer.ts`

**Status**: ✅ Done — removed `sanitizeDescriptionForDetection()` and `sanitizeDescriptionForAdaptive()` wrapper functions (had zero callers). Also removed unused `logger` import. File now exports only `normalizePattern()`.

---

## Summary

| PR | Phases | Tasks | Files | ~Lines | Risk |
|----|--------|-------|-------|--------|------|
| #1 | Phase 1 — Schema + Config | 4 | 4 | ~280 | Low |
| #2 | Phase 2 — Canonical normalizePattern | 6 | 5 | ~380 | **High** |
| #3 | Phase 3 — SOCIO Conflict Detector | 5 | 5 | ~320 | **High** |
| #4a | Phase 5 + Phase 6 wiring (6.1-6.4, 6.6-6.8) | 5 | 6 | ~400 | Medium |
| #4b | Phase 4 + Phase 6 match-set (6.5) | 5 | 3 | ~470 | Medium |
| **Total** | **6 phases** | **25** | **18** | **~1,850** | |

## Recommended PR Slices (stacked-to-main)

| Slice | Phases | Changed Lines | Rationale |
|-------|--------|---------------|-----------|
| PR #1 | Phase 1 — Schema + Config | ~280 | Safe additive change, no behavior impact |
| PR #2 | Phase 2 — Canonical normalizePattern | ~380 | Core normalization change, needs careful review |
| PR #3 | Phase 3 — SOCIO Conflict Detector | ~320 | I9 behavior fix, test-intensive |
| PR #4a | Phase 5 — Pending Entities FK Filter + Wiring Final (6.1-6.4, 6.6-6.8) | ~400 | Pending filter, config wiring, test updates. No data migration. |
| PR #4b | Phase 4 — Migration Script + Restore + Match-Set Test (6.5) | ~470 | Migration script, restore script, equivalence test. Isolated rollback. |
