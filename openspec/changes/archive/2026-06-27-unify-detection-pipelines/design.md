# Design: Unify Detection Pipelines

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     BEFORE (9 divergent pipelines)               │
│                                                                  │
│  pattern-normalizer.ts        entity-detector.ts                 │
│  ┌─────────────────────┐     ┌──────────────────────────────┐    │
│  │ normalizePattern()  │     │ sanitizeDescriptionFor-      │    │
│  │ (strips INDN/DES    │     │ Detection() — config-driven  │    │
│  │  prefixes, specific │     │ strip patterns, THEN         │    │
│  │  regex patterns)    │     │ collapse+trim               │    │
│  └─────────┬───────────┘     └─────────────┬────────────────┘    │
│            │                               │                     │
│  entity-classifier.ts           adaptive-engine.ts               │
│  ┌─────────────────────┐     ┌──────────────────────────────┐    │
│  │ normalizePattern()  │     │ sanitizeDescriptionFor-      │    │
│  │ same as above       │     │ Adaptive() — noise config + │    │
│  └─────────┬───────────┘     │ stop words filter            │    │
│            │                 └──────────────────────────────┘    │
│  rule-matching-engine.ts                                          │
│  ┌─────────────────────┐                                          │
│  │ inline: toLowerCase │                                          │
│  │ + trim + collapse   │    SOCIO detection duplicated x3        │
│  │ (NO strip)          │    ┌──────────────────────────────┐      │
│  └─────────────────────┘    │ entity-classifier.ts         │      │
│                             │   detectEntityConflict()     │      │
│  Config: 3 JSON files       │ entity-enricher.ts           │      │
│  ┌─────────────────────┐    │   hasSocioConflict()         │      │
│  │ entity-detection    │    │ rule-matching-engine.ts      │      │
│  │ learning-engine     │    │   entityFirstCheck()         │      │
│  │ predictive-recon    │    └──────────────────────────────┘      │
│  └─────────────────────┘                                          │
└──────────────────────────────────────────────────────────────────┘

                              ▼

┌──────────────────────────────────────────────────────────────────┐
│                      AFTER (unified, 1 source)                    │
│                                                                  │
│  pattern-normalizer.ts        entity-conflict-detector.ts       │
│  ┌─────────────────────┐     ┌──────────────────────────────┐    │
│  │ normalizePattern()  │     │ detectConflict()             │    │
│  │ CANONICAL:          │     │ Single SOCIO detector        │    │
│  │ trim→collapse→lower→│     │ checks entityFirstMode       │    │
│  │ strip punct→collapse│     │ consistently                 │    │
│  │ →trim               │     └──────────┬───────────────────┘    │
│  │ NO prefix stripping │                │                        │
│  │ Pure function       │       ┌────────┼─────────────┐          │
│  └──────────┬──────────┘       │        │             │          │
│             │                  │        │             │          │
│  ┌──────────┼──────────┐       │  entity-  │  rule-   │          │
│  │          │          │       │ classifier  matching  │          │
│  │  entity   │ adaptive │       │  .ts    │  engine   │          │
│  │ detector │  engine  │       │          │  .ts      │          │
│  │  .ts     │  .ts     │       └──────────┘  └──────────┘          │
│  │          │          │                                           │
│  │ Pre-     │ Pre-     │                                           │
│  │ process  │ process  │  detection-config.ts                      │
│  │ INDN:/   │ (domain  │  ┌──────────────────────────────┐        │
│  │ DES:     │ strip    │  │ loadDetectionConfig(id)      │        │
│  │ prefixes │ before   │  │ DB table → per-company       │        │
│  │  normal- │ normal-  │  │ default 0.85 / fuzzy          │        │
│  │  ize()   │ ize() )  │  │ Old JSONs → deprecation warn │        │
│  └──────────┴──────────┘  └──────────────────────────────┘        │
│                                                                  │
│  pending-entities/route.ts                                       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ FK filter: entityContextId !== null instead of pattern-match │ │
│  │ All entities always visible (recall > precision)             │ │
│  │ Badge "Ya cubierta" when covered                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  scripts/normalization-migration.ts                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ One-shot: re-normalize all BankRule patterns                 │ │
│  │ Collision: same GL → consolidate, diff GL → CRITICAL + keep │ │
│  │ Output: migration-report.json + SQL dump rollback             │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| **Canonical `normalizePattern()`** | Pure function — trim, collapse, lowercase, strip ASCII punctuation, collapse, trim | No I/O, deterministic, testable. Domain-specific stripping moved to callers as pre-processing |
| **Prefix stripping removed** | Callers must pre-process INDN:/DES:/Zelle/etc. before calling `normalizePattern()` | The canonical function must be domain-agnostic. Each pipeline has different pre-processing needs |
| **SOCIO detector consolidation** | Single `detectConflict()` checks `entityFirstMode` — fixing I9 | The old `entityFirstCheck()` checked the flag but `detectEntityConflict()` and `hasSocioConflict()` did NOT. Single function ensures consistency |
| **Pending filter** | FK-based (`entityContextId`), not pattern-match | Pattern-matching is O(n*m) and misses rules created with different normalization. FK is O(1), accurate, and survives normalization changes |
| **Config** | DB table with per-company overrides | Enables per-company tuning without file-system access. Old JSON files emit deprecation warnings |
| **Migration error resilience** | Individual rule errors logged and continued | 1000+ rules across companies — one bad rule must not block the entire migration |
| **Collision: same GL** | Consolidate: keep manual or most recent, deactivate other | Prevents duplicates while preserving user edits |
| **Collision: diff GL** | CRITICAL log, keep both active | Configuration error — human must review |
| **Rollback** | SQL dump of BankRule table + git revert | Full atomic rollback capability |

---

## 2. Component Design

### 2.1 normalizePattern() — Canonical Implementation

**File**: `src/lib/services/pattern-normalizer.ts`

#### Interface

```typescript
/**
 * Canonical pattern normalization function.
 *
 * Algorithm (in order):
 * 1. Strip leading/trailing whitespace
 * 2. Collapse internal whitespace (any seq → single space)
 * 3. Lowercase (toLowerCase)
 * 4. Strip ASCII punctuation (see PUNCTUATION_REGEX)
 * 5. Collapse whitespace again (after stripping, adjacent spaces may form)
 * 6. Trim again
 *
 * This function does NOT strip domain-specific prefixes (INDN:, DES:, etc.).
 * Callers must pre-process before calling if needed.
 *
 * Pure function — no I/O, no side effects, no external dependencies.
 */
export function normalizePattern(input: string): string;
```

#### Algorithm (exact steps)

```
normalizePattern(input):
  1. s = input.trim()
  2. s = s.replace(/\s+/g, ' ')       // collapse whitespace
  3. s = s.toLowerCase()
  4. s = s.replace(/[.,;:!?"'()\[\]{}\/\\|`~@#$%^&*\-+=<>]/g, '')  // strip punctuation
  5. s = s.replace(/\s+/g, ' ')       // collapse whitespace again
  6. return s.trim()
```

**Punctuation character set**: `. , ; : ! ? " ' ( ) [ ] { } / \ | ` ~ @ # $ % ^ & * - + = < >`

#### Implementation notes

- Uses a `const PUNCTUATION_REGEX` at module level for performance (precompiled)
- Unicode/accents preserved (e.g., `"Café"` → `"café"`, not `"cafe"`)
- Digits preserved (only punctuation removed)
- Empty input → `""` (no error)
- All-punctuation input → `""` (no error)

#### Migration of 4 call sites

| # | Call Site | Current Behavior | Migration |
|---|-----------|-----------------|-----------|
| 1 | `rule-matching-engine.ts` `evaluateCondition()` | Inline `toLowerCase().trim().replace(/\s+/g, ' ')` — NO punctuation strip | Replace inline normalization with `normalizePattern()` for both txValue and condValue. The current inline does NOT strip punctuation — adding punctuation strip changes behavior. Ship with `normalizePattern()`; verify match-set unchanged via the 100-rule/500-transaction equivalence test (REQ-NORM-02 scenario). |
| 2 | `entity-detector.ts` `sanitizeDescription()` → calls `sanitizeDescriptionForDetection()` | Config-driven strip patterns (INDN, DES, dates, refs, amounts) THEN collapse+trim | **Pre-processing**: strip config-driven noise patterns FIRST, THEN call `normalizePattern()`. The old `sanitizeDescriptionForDetection()` also included domain-specific stripping — that logic moves to a `preprocessForEntityDetection()` helper in `entity-detector.ts` before `normalizePattern()`. |
| 3 | `adaptive-engine.ts` `generateCandidateRules()` → calls `sanitizeDescriptionForAdaptive()` | Lowercase + trim → apply noise regexes + stop-words filter → collapse | **Pre-processing**: apply noise regexes + stop-words filter FIRST, THEN call `normalizePattern()`. The `sanitizeDescription()` alias is replaced with domain-specific pre-processing + canonical normalize. |
| 4 | `pattern-normalizer.ts` itself | Current `normalizePattern()` strips INDN/DES/Zelle/transfer prefixes → collapse | **Rewrite**: Remove all prefix-stripping logic. The function becomes the canonical pure version. Existing callers that depend on prefix stripping (`entity-classifier.ts`, `entity-context-service.ts`, `entity-detector.ts`) must add pre-processing at their call sites. |

#### Pre-processing decisions per caller

**entity-detector.ts** (`entity-detector.ts`):
```typescript
// New helper: domain-specific pre-processing before canonical normalize
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
  return cleaned; // → caller then calls normalizePattern()
}
```

The `sanitizeDescription()` export in entity-detector.ts becomes:
```typescript
export function sanitizeDescription(desc: string, config: EntityDetectionConfig): string {
  return normalizePattern(preprocessForEntityDetection(desc, config));
}
```

**entity-classifier.ts**: The current calls to `normalizePattern()` previously stripped INDN/DES prefixes. Now it must pre-process if those prefixes appear. However, `entity-classifier.ts` uses `normalizePattern()` in two places:
1. `computeDirectionProfile()` — uses `normalizePattern(pattern)` for `description contains` query — this is a DB query filter. The pattern is a user/entity pattern, not a raw description. Pre-processing not needed here unless the pattern itself contains INDN:DES prefixes.
2. `autoCreateRule()` — stores normalized pattern in `conditionValue`. Same reasoning.

**Decision**: The patterns stored in EntityContext are clean entity names (user-entered or AI-extracted), not raw bank descriptions with INDN:DES prefixes. So `entity-classifier.ts` call sites likely DON'T need pre-processing. But `entity-detector.ts` processes raw bank descriptions — it DOES need pre-processing.

**entity-context-service.ts**: Currently calls `normalizePattern()` on user-provided patterns. No pre-processing needed — user-entered patterns don't contain bank metadata prefixes.

### 2.2 Migration Script

**File**: `scripts/normalization-migration.ts`

#### Architecture

```
Entry: npx tsx scripts/normalization-migration.ts [--dry-run] [--output ./migration-report.json]
                                                   [--dump ./bank-rule-backup.sql]
   │
   ├─ 1. Take SQL dump of BankRule table (for rollback)
   │
   ├─ 2. Fetch ALL BankRule records, grouped by companyId
   │
   ├─ 3. For each company group:
   │      ├─ For each rule: apply normalizePattern(currentPattern)
   │      │   ├─ no change → add to skipped[]
   │      │   └─ changed → add to updated[]
   │      │
   │      └─ After normalizing all rules in company:
   │           Detect collisions: same normalized result within company
   │           ├─ same glAccountId → consolidate (keep manual/most recent, deactivate rest)
   │           ├─ diff glAccountId → CRITICAL log, keep both active
   │           └─ no conflict → normal update
   │
   ├─ 4. Generate migration-report.json
   │
   └─ 5. Exit code: 0 if all processed, non-zero if errors occurred
```

#### Key functions

```typescript
interface MigrationReport {
  runAt: string;
  dryRun: boolean;
  summary: {
    totalRules: number;
    updated: number;
    skipped: number;
    collisions: number;
    critical: number;
  };
  updated: Array<{
    ruleId: string;
    oldPattern: string;
    newPattern: string;
    companyId: string;
  }>;
  skipped: Array<{
    ruleId: string;
    pattern: string;
    companyId: string;
    reason: 'already_normalized';
  }>;
  collisions: Array<{
    normalizedPattern: string;
    companyId: string;
    sameGl: Array<{
      survivorId: string;
      deactivatedId: string;
      glAccountId: string;
      reason: 'manual' | 'updatedAt';
      auditLogged: boolean;
    }>;
    differentGl: Array<{
      ruleIds: string[];
      glAccountIds: string[];
      criticalLogged: boolean;
    }>;
  }>;
  errors: Array<{
    ruleId: string;
    pattern: string;
    error: string;
  }>;
}
```

#### Collision handling logic

```typescript
function resolveCollision(
  rules: BankRule[],
  normalizedPattern: string,
): { survivor: BankRule; toDeactivate: BankRule[] } {
  const sameGl = groupByGlAccount(rules);

  for (const [glAccountId, group] of sameGl) {
    if (group.length === 1) continue; // No conflict

    // Sort: isManuallyEdited=true first, then by updatedAt desc
    group.sort((a, b) => {
      if (a.isManuallyEdited !== b.isManuallyEdited) {
        return a.isManuallyEdited ? -1 : 1;
      }
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const survivor = group[0];
    const toDeactivate = group.slice(1);

    // Survivor gets the normalized pattern, stays active
    // Others get deactivated
  }
}
```

#### Rollback

Before any writes, the script dumps all BankRule records to a JSON backup file using Prisma (no CLI dependency):
```typescript
// Cross-platform backup: works on any environment with Prisma
const backupPath = options.dump || './bank-rule-backup.json';
const allRules = await db.bankRule.findMany();
fs.writeFileSync(backupPath, JSON.stringify(allRules, null, 2));
```

Restore script (`scripts/restore-bank-rules.ts`):
```typescript
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const backup = JSON.parse(fs.readFileSync('./bank-rule-backup.json', 'utf-8'));
for (const rule of backup) {
  await db.bankRule.upsert({
    where: { id: rule.id },
    update: rule,
    create: rule,
  });
}
```

Full rollback procedure:
1. `npx tsx scripts/restore-bank-rules.ts` — restore BankRule data from JSON
2. `git revert HEAD` — revert code changes
3. Old JSON files stay on disk (deprecated but present — safe)
4. `npx vitest` — verify no regressions

### 2.3 entity-conflict-detector.ts — SOCIO Conflict Detection

**File**: `src/lib/services/entity-conflict-detector.ts`

#### Interface

```typescript
export interface ConflictResult {
  conflict: boolean;
  socioEntity?: { id: string; pattern: string; role: string };
  merchantEntity?: { id: string; pattern: string; role: string };
  reason?: string;
}

/**
 * Detect SOCIO conflict: a transaction matches both a SOCIO entity and a
 * non-SOCIO merchant/entity simultaneously.
 *
 * Consistently checks entityFirstMode flag (fixes I9):
 * - entityFirstMode=true  → entity-context takes precedence over rule matches
 * - entityFirstMode=false → rule-first resolution (default)
 *
 * @param companyId - company context
 * @param pattern - normalized pattern from the transaction/rule
 * @param description - raw description from the transaction
 * @returns ConflictResult
 */
export async function detectConflict(
  companyId: string,
  pattern: string,
  description: string,
): Promise<ConflictResult>;
```

#### Algorithm

```
detectConflict(companyId, pattern, description):
  1. Load company's entityFirstMode flag
  2. Load active EntityContext records for company (with role, glAccount, pattern)
  3. Load active BankRules for company
  4. Determine which entities/rules match the pattern/description:
     a. Split description into components (merchant P1, INDN P3)
     b. Find SOCIO entities matching the INDN name
     c. Find non-SOCIO entities matching the merchant name (P1) or overall pattern
  5. If BOTH a SOCIO entity AND a non-SOCIO entity match:
     a. If entityFirstMode → entity wins (socioEntity takes precedence)
     b. If !entityFirstMode → rule wins (merchantEntity takes precedence)
     c. Set conflict=true, populate both entities
  6. Return { conflict, socioEntity?, merchantEntity?, reason? }
```

#### Migration of 3 call sites

| # | File | Old Function | Migration |
|---|------|-------------|-----------|
| 1 | `entity-classifier.ts` | `detectEntityConflict()` — no `entityFirstMode` check | Remove function. Replace calls with `detectConflict()` from new module. This FIXES I9 (was not checking entityFirstMode). |
| 2 | `entity-enricher.ts` | `hasSocioConflict()` (private) — no `entityFirstMode` check | Remove function. `resolveContextRole()` calls `detectConflict()`. This FIXES I9 (was not checking entityFirstMode). |
| 3 | `rule-matching-engine.ts` | `entityFirstCheck()` — already checks `entityFirstMode` | Remove `entityFirstCheck()`. `transactionMatchesRule()` calls `detectConflict()`. Behavior preserved. |

**Critical behavioral change**: `detectEntityConflict()` and `hasSocioConflict()` previously did NOT check `entityFirstMode`. After consolidation, they MUST check it because the single `detectConflict()` always checks the flag. This is intentional (fixes I9) but means entity-classifier and entity-enricher will behave differently from before when `entityFirstMode=true` — they will now defer to entity resolution, which is the correct behavior.

#### `extractComponents()` dependency

The new `detectConflict()` needs the `extractComponents()` function from `entity-detector.ts` for splitting descriptions into merchant/INDN segments. This is the same function used by all 3 old implementations. Import it directly — no duplication.

### 2.4 Detection Config — Centralized Loader

**File**: `src/lib/config/detection-config.ts`

#### Interface

```typescript
export interface DetectionConfig {
  threshold: number;        // Jaro-Winkler similarity, default 0.85
  clusterMode: 'fuzzy' | 'exact' | 'hybrid';  // default 'fuzzy'
  minOccurrences: number;   // default 2
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  threshold: 0.85,
  clusterMode: 'fuzzy',
  minOccurrences: 2,
};

/**
 * Async loader — checks DB per-company overrides.
 * Falls back to defaults when no override exists or on validation failure.
 */
export async function loadDetectionConfig(companyId?: string): Promise<DetectionConfig>;

/**
 * Sync loader — returns from in-memory cache or defaults.
 * MUST NOT perform I/O. Use when async is not available.
 */
export function loadDetectionConfigSync(companyId?: string): DetectionConfig;
```

#### Cache behavior

```typescript
// Module-level cache
const configCache = new Map<string, DetectionConfig | null>(); // null = not yet populated
let cachePopulated = false;

export async function loadDetectionConfig(companyId?: string): Promise<DetectionConfig> {
  const config = await loadFromDb(companyId);
  const validated = validateAndMergeDefaults(config);

  // Populate cache
  if (companyId) {
    configCache.set(companyId, validated);
  }
  cachePopulated = true;

  return validated;
}

export function loadDetectionConfigSync(companyId?: string): DetectionConfig {
  if (!cachePopulated) {
    return DEFAULT_DETECTION_CONFIG; // No I/O — safe fallback
  }
  if (companyId && configCache.has(companyId)) {
    return configCache.get(companyId)!;
  }
  return DEFAULT_DETECTION_CONFIG;
}
```

#### Validation

```typescript
function validateThreshold(value: unknown, logger: Logger): number {
  if (typeof value === 'number' && value >= 0.0 && value <= 1.0) {
    return value;
  }
  logger.warn(`threshold=${value} is out of range [0.0, 1.0], falling back to 0.85`);
  return DEFAULT_DETECTION_CONFIG.threshold;
}

function validateClusterMode(value: unknown, logger: Logger): 'fuzzy' | 'exact' | 'hybrid' {
  if (value === 'fuzzy' || value === 'exact' || value === 'hybrid') {
    return value;
  }
  logger.warn(`clusterMode="${value}" is invalid, falling back to "fuzzy"`);
  return DEFAULT_DETECTION_CONFIG.clusterMode;
}
```

#### Deprecation warning (startup)

```typescript
const DEPRECATED_FILES = [
  'rules/entity-detection.json',
  'rules/learning-engine.json',
  'rules/predictive-recon.json',
];

export function checkDeprecatedConfigFiles(): void {
  for (const filePath of DEPRECATED_FILES) {
    const fullPath = join(process.cwd(), filePath);
    if (existsSync(fullPath)) {
      logger.warn(
        `[detection-config] File ${filePath} is deprecated. ` +
        `Use DetectionConfig DB table instead. This file will be removed in a future release.`,
      );
    }
  }
}
```

### 2.5 Pending Entities Filter — FK-based

**File**: `src/app/api/learning/pending-entities/route.ts`

#### Updated algorithm

```
GET /api/learning/pending-entities:
  1. Load unclassified transactions for company (as before)
  2. Cluster candidates (as before)
  3. Load ALL EntityContext records for company
  4. Load active BankRules with non-null entityContextId for company
  5. Build a Set<string> of entityContextIds that have active rules: coveredIds
  6. For each entity:
     - Mark isCovered = coveredIds.has(entity.id)
     - Include ALL entities (no filtering out of covered ones)
  7. Response: { success, candidates: Array<Entity & { isCovered: boolean }> }
```

#### Response shape change

```typescript
// Before
interface PendingEntity {
  id: string;
  pattern: string;
  occurrences: number;
  // ... other fields
}

// After
interface PendingEntity {
  id: string;
  pattern: string;
  occurrences: number;
  isCovered: boolean;  // NEW: true if active BankRule has entityContextId matching this entity
  // ... other fields
}
```

#### Frontend badge

In the UI component rendering pending entities:
```tsx
{entity.isCovered && (
  <span className="badge badge-success">Ya cubierta</span>
)}
```

The badge is rendered on top of the entity card. The entity is NOT hidden — all entities remain visible. This preserves the `recall > precision` design principle.

#### Rule for coverage determination

```typescript
// In the route handler (or a helper)
const coveredEntityIds = new Set<string>();

const activeLinkedRules = await db.bankRule.findMany({
  where: {
    companyId,
    isActive: true,
    entityContextId: { not: null },
  },
  select: { entityContextId: true },
});

for (const rule of activeLinkedRules) {
  if (rule.entityContextId) {
    coveredEntityIds.add(rule.entityContextId);
  }
}

// Apply isCovered to each candidate
const candidatesWithCoverage = candidates.map((c) => ({
  ...c,
  isCovered: coveredEntityIds.has(c.id),
}));
```

---

## 3. Data Model

### 3.1 DetectionConfig Prisma Model

Add to `prisma/schema.prisma`:

```prisma
model DetectionConfig {
  companyId      String   @id
  threshold      Float?   // null = use default 0.85
  clusterMode    String?  @default("fuzzy")  // "fuzzy" | "exact" | "hybrid"
  minOccurrences Int?     // null = use default 2
  updatedAt      DateTime @updatedAt
  updatedBy      String?  // userId who last changed the override
}
```

**Migration**: `npx prisma migrate dev --name add_detection_config`

Safe: additive only (new table, no existing data affected).

### 3.2 migration-report.json Schema

```json
{
  "$schema": "https://example.com/detection-migration-report-v1.schema",
  "runAt": "2026-06-28T12:00:00.000Z",
  "dryRun": false,
  "summary": {
    "totalRules": 1500,
    "updated": 1200,
    "skipped": 280,
    "collisions": 18,
    "critical": 2
  },
  "updated": [
    {
      "ruleId": "rule_001",
      "oldPattern": "  INTERES  BANCARIO  ",
      "newPattern": "interes bancario",
      "companyId": "comp_1"
    }
  ],
  "skipped": [
    {
      "ruleId": "rule_002",
      "pattern": "interes bancario",
      "companyId": "comp_1",
      "reason": "already_normalized"
    }
  ],
  "collisions": [
    {
      "normalizedPattern": "interes",
      "companyId": "comp_1",
      "sameGl": [
        {
          "survivorId": "rule_003",
          "deactivatedId": "rule_004",
          "glAccountId": "gl_001",
          "reason": "manual",
          "auditLogged": true
        }
      ],
      "differentGl": [
        {
          "ruleIds": ["rule_005", "rule_006"],
          "glAccountIds": ["gl_001", "gl_999"],
          "criticalLogged": true
        }
      ]
    }
  ],
  "errors": [
    {
      "ruleId": "rule_999",
      "pattern": "INVALID\tPATTERN\u0000NULL",
      "error": "Database constraint violation: pattern exceeds max length"
    }
  ]
}
```

---

## 4. Migration Plan

### 4.1 Script Design

**File**: `scripts/normalization-migration.ts`

**Entry point**: `npx tsx scripts/normalization-migration.ts [options]`

**Options**:
- `--dry-run` — simulate without writing to DB
- `--output <path>` — report output path (default: `./migration-report.json`)
- `--dump <path>` — JSON backup path (default: `./bank-rule-backup.json`)
- `--batch-size <n>` — rules per batch (default: 500)

**Execution flow**:

```typescript
async function main() {
  const options = parseArgs();
  const db = getDbConnection();
  const report: MigrationReport = initReport(options.dryRun);

  // 1. Backup
  if (!options.dryRun) {
    await backupBankRules(db, options.dump);
  }

  // 2. Fetch all rules, grouped by company
  const rulesByCompany = await fetchRulesGroupedByCompany(db);

  for (const [companyId, rules] of rulesByCompany) {
    try {
      const normalized = new Map<string, NormalizedRule[]>();

      // 3. Normalize each rule
      for (const rule of rules) {
        try {
          const newPattern = normalizePattern(rule.conditionValue);
          if (newPattern === rule.conditionValue) {
            report.skipped.push({ ruleId: rule.id, pattern: rule.conditionValue, companyId, reason: 'already_normalized' });
            report.summary.skipped++;
          } else {
            report.updated.push({ ruleId: rule.id, oldPattern: rule.conditionValue, newPattern, companyId });
            report.summary.updated++;

            // Group by normalized pattern for collision detection
            if (!normalized.has(newPattern)) normalized.set(newPattern, []);
            normalized.get(newPattern)!.push({ rule, normalizedPattern: newPattern });
          }
        } catch (err) {
          report.errors.push({ ruleId: rule.id, pattern: rule.conditionValue, error: String(err) });
        }
      }

      // 4. Detect and resolve collisions
      for (const [normPattern, normRules] of normalized) {
        if (normRules.length < 2) continue; // No collision

        const glGroups = groupByGlAccount(normRules);
        for (const [glId, group] of glGroups) {
          if (group.length < 2) continue;

          if (glId) {
            // Same GL → consolidate
            const { survivor, deactivated } = resolveSameGlCollision(group);
            report.collisions.push({
              normalizedPattern: normPattern,
              companyId,
              sameGl: [{
                survivorId: survivor.rule.id,
                deactivatedId: deactivated.rule.id,
                glAccountId: glId,
                reason: survivor.rule.isManuallyEdited ? 'manual' : 'updatedAt',
                auditLogged: true,
              }],
              differentGl: [],
            });
            report.summary.collisions++;

            if (!options.dryRun) {
              await applyConsolidation(db, survivor, deactivated);
            }
          }
        }

        // Different GL → CRITICAL
        const differentGlGroups = normRules.filter(r => !sameGlAsOthers(r, normRules));
        if (differentGlGroups.length > 0) {
          // ... CRITICAL log + record in report
        }
      }

      // 5. Apply non-collision updates
      if (!options.dryRun) {
        await applyNormalizedUpdates(db, report.updated);
      }
    } catch (err) {
      logger.error(`Company ${companyId} migration failed`, { error: String(err) });
    }
  }

  // 6. Write report
  await writeReport(report, options.output);
}
```

### 4.2 Error Resilience

- Individual rule errors are caught and recorded in `report.errors[]` — they do NOT halt processing
- Company-level errors are caught — the company is skipped but others continue
- If NO rules were processed successfully, exit code is non-zero
- The `--dry-run` flag never writes to DB

### 4.3 Rollback Procedure

```bash
# 1. Restore BankRule data
psql -d "$DATABASE_URL" -f bank-rule-backup.sql

# 2. Revert code changes
git revert HEAD

# 3. Re-run old tests
npx vitest
```

**Note**: The rollback restores only the BankRule table. Code changes are reverted. The DetectionConfig table and new files remain (they are additive and unused after rollback — irrelevant).

---

## 5. Test Strategy

### 5.1 normalizePattern() — Unit Tests

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 1 | Basic whitespace normalization | `"  INTERES  BANCARIO  "` | `"interes bancario"` |
| 2 | Tab and newline collapse | `"ACME\tCORP\nSA"` | `"acme corp sa"` |
| 3 | Punctuation stripped | `"MERCADO LIBRE S.A. - (CUIT 30-..."` | `"mercado libre sa cuit 30"` |
| 4 | Unicode preserved | `"Café Martínez"` | `"café martínez"` |
| 5 | Empty input | `""` | `""` |
| 6 | Only punctuation | `"!@#$%^&*()"` | `""` |
| 7 | Numeric input | `"1234-5678/90"` | `"1234567890"` |
| 8 | INDN:DES prefixes NOT stripped | `"INDN: ACME CORP"` | `"indn acme corp"` |
| 9 | Leading/trailing spaces stripped | `"  hello world  "` | `"hello world"` |
| 10 | Multiple spaces collapsed | `"a    b"` | `"a b"` |
| 11 | Pure function — no side effects | Verify no global state mutation | Pass |
| 12 | Hyphen stripped (it's punctuation) | `"well-known"` | `"wellknown"` |
| 13 | Apostrophe stripped | `"O'Brien"` | `"obrien"` |
| 14 | Repeated collapse after punctuation removal | `"a , b"` | `"a b"` |

**File**: `tests/services/pattern-normalizer.test.ts`

### 5.2 Migration Script — Tests

| # | Test Case | Verification |
|---|-----------|-------------|
| 1 | Dry run does not mutate DB | Verify no UPDATE queries executed |
| 2 | Already-normalized rule skipped | Report shows `reason: 'already_normalized'` |
| 3 | Single rule normalized | Report `updated` has correct old→new |
| 4 | Same GL collision: manual wins | `survivor` is manual rule, other deactivated |
| 5 | Same GL collision: neither manual → newest wins | `survivor` is most recent `updatedAt` |
| 6 | Different GL collision → CRITICAL | Both updated, both active, CRITICAL logged |
| 7 | Critical collision does not halt migration | Remaining companies processed |
| 8 | Error in single rule recorded | Report `errors` populated, other rules processed |
| 9 | Report includes all sections | Verify `summary` totals match actual counts |
| 10 | Consolidation deactivates and nullifies FK | Deactivated rule has `isActive=false`, `entityContextId=null` |
| 11 | Audit event logged for consolidation | Check AuditLog for action `RULE_COLLISION_RESOLVED` |

**Note**: Migration tests use an in-memory SQLite DB (or test transaction with rollback) to avoid touching production data.

### 5.3 entity-conflict-detector.ts — Tests

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 1 | SOCIO + merchant conflict detected | SOCIO + PROVEEDOR both match | `conflict: true`, both entities populated |
| 2 | Only SOCIO exists | Only SOCIO matches | `conflict: false`, `socioEntity` set |
| 3 | Only merchant exists | Only PROVEEDOR matches | `conflict: false`, `merchantEntity` set |
| 4 | No match | Nothing matches | `conflict: false`, both null |
| 5 | entityFirstMode=true | Entity vs rule → entity wins | SOCIO takes precedence |
| 6 | entityFirstMode=false | Entity vs rule → rule wins | Merchant takes precedence |
| 7 | entityFirstMode not set | Defaults to false | Behaves like `false`, no error |
| 8 | Same result as old `detectEntityConflict()` | Known fixture | Identical output |
| 9 | Same result as old `hasSocioConflict()` | Known fixture | Identical output |
| 10 | Same result as old `entityFirstCheck()` | Known fixture | Identical output |

**File**: `tests/services/entity-conflict-detector.test.ts`

### 5.4 detection-config.ts — Tests

| # | Test Case | Verification |
|---|-----------|-------------|
| 1 | No override → defaults | Returns `{ threshold: 0.85, clusterMode: 'fuzzy', minOccurrences: 2 }` |
| 2 | Company override threshold only | `threshold: 0.92`, clusterMode default |
| 3 | Full override | Both threshold and clusterMode overridden |
| 4 | Sync loader returns cached values | After async load, sync returns same |
| 5 | Sync loader before cache | Returns defaults without I/O, no throw |
| 6 | Invalid threshold → fallback + warn | `threshold: 2.5` → `0.85` + warning |
| 7 | Invalid clusterMode → fallback + warn | `clusterMode: 'levenshtein'` → `'fuzzy'` + warning |
| 8 | Deprecation warning when JSON exists | 3 WARN messages emitted at startup |
| 9 | No warning when JSON files removed | No deprecation messages |
| 10 | `minOccurrences` default and override | Default 2, override in DB respected |

**File**: `tests/config/detection-config.test.ts`

### 5.5 Pending Entities Filter — Tests

| # | Test Case | Verification |
|---|-----------|-------------|
| 1 | Entity with active rule → `isCovered: true` | Badge shown |
| 2 | Entity without rule → `isCovered: false` | No badge, entity visible |
| 3 | Entity with inactive rule → `isCovered: false` | Entity actionable |
| 4 | No entity hidden | All 50 entities in response even if 15 covered |
| 5 | Manual rule (null entityContextId) → doesn't cover | Entity with same pattern not covered |
| 6 | Multiple entities, mixed coverage | Correct isCovered per entity |

### 5.6 Regression Tests

| # | Test Case | Verification |
|---|-----------|-------------|
| 1 | 35 existing entity-classifier tests pass | `npx vitest tests/services/entity-classifier.test.ts` |
| 2 | Rule-matching engine same match set | 100 rules × 500 transactions — same matched pairs |
| 3 | Entity-enricher same enrichment output | Fixture comparison before/after |

---

## 6. Affected Files

### New Files (7)

| File | Purpose |
|------|---------|
| `src/lib/services/entity-conflict-detector.ts` | Single SOCIO conflict detection — `detectConflict()` |
| `src/lib/config/detection-config.ts` | Centralized detection config loader — `loadDetectionConfig()`, `loadDetectionConfigSync()`, `checkDeprecatedConfigFiles()` |
| `scripts/normalization-migration.ts` | One-shot migration script — re-normalize BankRule.pattern, collision handling, report generation |
| `tests/services/pattern-normalizer.test.ts` | Unit tests for canonical `normalizePattern()` |
| `tests/services/entity-conflict-detector.test.ts` | Unit tests for `detectConflict()` |
| `tests/config/detection-config.test.ts` | Unit tests for config loader |
| `prisma/migrations/*add_detection_config*` | Auto-generated Prisma migration for DetectionConfig table |

### Modified Files (11)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `DetectionConfig` model |
| `src/lib/services/pattern-normalizer.ts` | Rewrite `normalizePattern()` as canonical pure function; remove prefix-stripping, remove `sanitizeDescriptionForDetection()`, remove `sanitizeDescriptionForAdaptive()` |
| `src/lib/services/rule-matching-engine.ts` | Replace inline normalization in `evaluateCondition()` with `normalizePattern()`; remove `entityFirstCheck()`, import + call `detectConflict()` |
| `src/lib/services/entity-classifier.ts` | Remove `detectEntityConflict()`, import + call `detectConflict()`; verify `normalizePattern()` call sites need no pre-processing |
| `src/lib/services/entity-enricher.ts` | Remove `hasSocioConflict()`, replace with `detectConflict()` call in `resolveContextRole()` |
| `src/lib/services/entity-detector.ts` | Extract domain-specific pre-processing from `sanitizeDescription()`; delegate to `normalizePattern()` after pre-processing |
| `src/lib/learning/adaptive-engine.ts` | Replace `sanitizeDescriptionForAdaptive()` with domain-specific pre-processing → `normalizePattern()` |
| `src/app/api/learning/pending-entities/route.ts` | Change filter from pattern-match to FK-based (`entityContextId`); add `isCovered` to response; remove filtering of covered entities |
| `src/lib/services/entity-context-service.ts` | Verify `normalizePattern()` call still works (user patterns don't need pre-processing) |
| `rules/entity-detection.json` | Deprecated — readers replaced with `loadDetectionConfig()` |
| `rules/learning-engine.json` | Deprecated — readers replaced with `loadDetectionConfig()` |
| `rules/predictive-recon.json` | Deprecated — readers replaced with `loadDetectionConfig()` |

### Read-Only Check (no code change expected)

| File | Action |
|------|--------|
| `src/lib/services/entity-context-crud-service.ts` | Verify no `normalizePattern()` calls exist |
| `tests/services/entity-classifier.test.ts` | Run after changes to confirm no breakage (35 tests) |

---

## 7. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Normalization change alters match results** | Medium | REQ-NORM-02 requires 100-rule/500-transaction match-set equivalence test. Any differences documented as known behavioral change. |
| **Migration collision on production data** | Medium | SQL dump rollback + `--dry-run` flag. Collision behavior is conservative (different GL → both kept). |
| **entityFirstMode fix changes existing SOCIO behavior** | Medium | Intentional fix of I9. `detectEntityConflict()` and `hasSocioConflict()` previously ignored the flag. Now they behave consistently with `entityFirstCheck()`. Recorded outputs compared against fixture. |
| **INDN:DES prefixes no longer stripped by normalizePattern** | Medium | Callers in `entity-detector.ts` and `adaptive-engine.ts` now pre-process. Tests verify raw bank descriptions still strip correctly. |
| **35 entity-classifier tests break** | Low | The canonical `normalizePattern()` differs from current version (no prefix strip). If tests depended on prefix stripping, they break. Mitigation: update callers to pre-process. |
| **DetectionConfig migration — existing JSON values lost** | Low | JSON values are NOT auto-migrated to DB. Admin must manually set overrides. Old JSON files are preserved (deprecated, not deleted). No data loss. |

---

## 8. Deployment Order

1. **Prisma migration**: `npx prisma migrate dev --name add_detection_config` — additive, no existing data affected
2. **Deploy detection-config.ts** — safe rollout (old code still reads JSON files, new config loader not used yet)
3. **Deploy entity-conflict-detector.ts** — safe rollout (old functions still exist, new function not called yet)
4. **Switch callers** one at a time:
   a. Rewrite `pattern-normalizer.ts` + update `entity-detector.ts` pre-processing
   b. Update `rule-matching-engine.ts` — inline normalization → `normalizePattern()`, `entityFirstCheck()` → `detectConflict()`
   c. Update `entity-classifier.ts` — `detectEntityConflict()` → `detectConflict()`
   d. Update `entity-enricher.ts` — `hasSocioConflict()` → `detectConflict()`
   e. Update `adaptive-engine.ts` — `sanitizeDescriptionForAdaptive()` → pre-process + `normalizePattern()`
   f. Update `pending-entities/route.ts` — FK filter
5. **Run migration script**: `scripts/normalization-migration.ts --dry-run` to preview, then without flag
6. **Verify**: Run all 35 entity-classifier tests, match-set equivalence test, and pending-entities endpoint
7. **Remove old JSON file readers** (after verification):
   - Replace `loadConfig()` in `entity-detector.ts` with `loadDetectionConfig()`
   - Replace `loadLearningEngineConfig()` in `adaptive-engine.ts` with `loadDetectionConfig()`
   - Keep JSON files on disk (deprecated warnings are acceptable)
