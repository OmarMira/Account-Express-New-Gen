# Detection Configuration Specification — Delta

## Purpose

Define the centralized detection configuration loader that replaces 3 JSON config files (`entity-detection.json`, `learning-engine.json`, `predictive-recon.json`) with a single DB-backed source and optional per-company overrides.

## Dependencies

- **Deprecates**: `rules/entity-detection.json`, `rules/learning-engine.json`, `rules/predictive-recon.json`
- **Depends on**: `openspec/changes/unify-detection-pipelines/specs/normalization/spec.md` (threshold affects clustering)
- **Depends on**: `openspec/specs/entity-classification/spec.md` (classification clustering modes)

---

## Requirements

### REQ-CFG-01 — Single detection config loader

The system MUST provide a single exported loader at `src/lib/config/detection-config.ts` with:

```typescript
interface DetectionConfig {
  threshold: number;        // Jaro-Winkler similarity threshold, default 0.85
  clusterMode: 'fuzzy' | 'exact' | 'hybrid';  // default 'fuzzy'
}

function loadDetectionConfig(companyId?: string): Promise<DetectionConfig>;
function loadDetectionConfigSync(companyId?: string): DetectionConfig; // for non-async contexts
```

`loadDetectionConfig()` MUST first check for a company-specific override in the DB table. If no override exists, it MUST return the system defaults. `loadDetectionConfigSync()` MUST use an in-memory cache populated at startup or on first async load — it MUST NOT perform synchronous I/O.

#### Scenario: Default config returned with no overrides

- GIVEN no company-specific override exists
- WHEN `loadDetectionConfig()` is called (with or without companyId)
- THEN it MUST return `{ threshold: 0.85, clusterMode: 'fuzzy' }`

#### Scenario: Sync loader returns cached values

- GIVEN the async loader has been called once and cache is populated
- WHEN `loadDetectionConfigSync()` is called
- THEN it returns the same value as the async loader for the same company
- AND it does NOT perform any I/O

#### Scenario: Sync loader before cache populated

- GIVEN the cache has NOT been populated yet
- WHEN `loadDetectionConfigSync()` is called
- THEN it MUST return the system defaults (`{ threshold: 0.85, clusterMode: 'fuzzy' }`)
- AND it MUST NOT throw or fall back to file I/O

---

### REQ-CFG-02 — DB table with per-company overrides

A database table `DetectionConfig` (or equivalent Prisma model) MUST store per-company overrides:

```prisma
model DetectionConfig {
  companyId    String   @id
  threshold    Float?   // null = use default
  clusterMode  String?  // 'fuzzy' | 'exact' | 'hybrid', null = use default
  updatedAt    DateTime @updatedAt
  updatedBy    String?  // userId who last changed the override
}
```

If `threshold` is `null` or absent, the system default `0.85` MUST be used. If `clusterMode` is `null` or absent, the system default `'fuzzy'` MUST be used. Rows MUST be upserted (never deleted — set to null to restore default).

#### Scenario: Company override with custom threshold

- GIVEN the DB has `DetectionConfig { companyId: "comp_1", threshold: 0.92, clusterMode: null }`
- WHEN `loadDetectionConfig("comp_1")` is called
- THEN it MUST return `{ threshold: 0.92, clusterMode: 'fuzzy' }` (threshold overridden, clusterMode uses default)

#### Scenario: Full company override

- GIVEN `DetectionConfig { companyId: "comp_2", threshold: 0.80, clusterMode: "hybrid" }`
- WHEN `loadDetectionConfig("comp_2")` is called
- THEN it MUST return `{ threshold: 0.80, clusterMode: 'hybrid' }`

#### Scenario: Company with no override uses defaults

- GIVEN no DetectionConfig row exists for "comp_3"
- WHEN `loadDetectionConfig("comp_3")` is called
- THEN it MUST return `{ threshold: 0.85, clusterMode: 'fuzzy' }`

---

### REQ-CFG-03 — Default threshold 0.85, default clusterMode 'fuzzy'

The system defaults MUST be:

| Property | Default | Type | Description |
|----------|---------|------|-------------|
| `threshold` | `0.85` | number (0.0-1.0) | Jaro-Winkler similarity threshold for fuzzy matching |
| `clusterMode` | `'fuzzy'` | `'fuzzy' \| 'exact' \| 'hybrid'` | Default clustering algorithm |

These defaults MUST be defined as exported constants in `detection-config.ts`:

```typescript
export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  threshold: 0.85,
  clusterMode: 'fuzzy',
};
```

#### Scenario: Default threshold applied to fuzzy clustering

- GIVEN `loadDetectionConfig()` returns `{ threshold: 0.85, clusterMode: 'fuzzy' }`
- WHEN `clusterCandidates()` is called with these options
- THEN Jaro-Winkler similarity uses 0.85 as the match threshold
- AND behavior is identical to the pre-change default from `entity-detection.json`

---

### REQ-CFG-04 — Old JSON files deprecated with runtime warning

The following files in `rules/` are deprecated:

- `rules/entity-detection.json`
- `rules/learning-engine.json`
- `rules/predictive-recon.json`

On startup, the system MUST check if any of these files still exist. If any is found, a deprecation warning MUST be logged:

```
WARN [detection-config] File rules/entity-detection.json is deprecated. 
Use DetectionConfig DB table instead. This file will be removed in a future release.
```

These files MUST NOT be read by any production code after this change. The old file readers (`loadConfig()` in entity-detector, `loadLearningEngineConfig()` in adaptive-engine, etc.) MUST be replaced with `loadDetectionConfig()`.

#### Scenario: Deprecation warning at startup

- GIVEN `rules/entity-detection.json` still exists in the filesystem
- WHEN the application starts
- THEN a WARN-level log message is emitted indicating the file is deprecated
- AND the file is NOT read for configuration values

#### Scenario: No warning when files are removed

- GIVEN all 3 JSON files have been deleted from `rules/`
- WHEN the application starts
- THEN no deprecation warning is emitted
- AND configuration loads from defaults or DB table as expected

#### Scenario: All 3 files generate separate warnings

- GIVEN all 3 deprecated JSON files exist
- WHEN the application starts
- THEN 3 separate WARN messages are logged, one per file
- AND each identifies which file is deprecated

---

### REQ-CFG-05 — Config values validated on load

When loading config (either from DB or defaults), the system MUST validate:

- `threshold`: MUST be a number between `0.0` and `1.0` (inclusive). Invalid values MUST fall back to `0.85` with a WARN log.
- `clusterMode`: MUST be one of `'fuzzy'`, `'exact'`, `'hybrid'`. Invalid values MUST fall back to `'fuzzy'` with a WARN log.

#### Scenario: Invalid threshold falls back

- GIVEN `DetectionConfig { companyId: "comp_1", threshold: 2.5, clusterMode: "fuzzy" }`
- WHEN `loadDetectionConfig("comp_1")` is called
- THEN a WARN log is emitted: `threshold=2.5 is out of range [0.0, 1.0], falling back to 0.85`
- AND the returned config uses `threshold: 0.85`

#### Scenario: Invalid clusterMode falls back

- GIVEN `DetectionConfig { companyId: "comp_1", threshold: null, clusterMode: "levenshtein" }`
- WHEN `loadDetectionConfig("comp_1")` is called
- THEN a WARN log is emitted: `clusterMode="levenshtein" is invalid, falling back to "fuzzy"`
- AND the returned config uses `clusterMode: 'fuzzy'`

---

## Non-Goals

- Migration of existing JSON config values to the DB (manual or separate admin task — not automated by this change)
- Direction threshold configuration (deferred to future change)
- UI for managing per-company overrides (admin panel is out of scope)
- Caching invalidation / hot-reload (config changes require restart or manual cache clear)
