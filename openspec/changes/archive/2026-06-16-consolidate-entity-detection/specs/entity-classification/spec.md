# Delta for Entity Classification

## ADDED Requirements

### Requirement: Unified Clustering with Configurable Mode

`clusterCandidates()` MUST accept an optional second argument `ClusterOptions` with a `mode` field accepting `"fuzzy"`, `"exact"`, or `"hybrid"`. Default MUST be `"fuzzy"`. Additional options: `requireRole` filters by role, `smartFrequency` adjusts min-occurrence thresholds dynamically, `extraNumberStrip` strips trailing numeric suffixes before matching.

- **fuzzy**: group by Jaro-Winkler similarity >= 0.85 on raw description (existing behavior).
- **exact**: group by normalized key equality (lowercase, strip punctuation, collapse whitespace).
- **hybrid**: attempt exact first; if no exact group meets min-occurrence, fall back to fuzzy.

#### Scenario: Fuzzy groups similar descriptions

- GIVEN transactions with descriptions "ACME CORP SA", "ACME CORP", "ACME CORP SRL"
- WHEN `clusterCandidates` is called with `{ mode: 'fuzzy' }`
- THEN all three descriptions are grouped into a single cluster

#### Scenario: Exact requires normalized equality

- GIVEN transactions "ACME CORP.", "acme corp", "ACME CORP SA"
- WHEN `clusterCandidates` is called with `{ mode: 'exact' }`
- THEN "ACME CORP." and "acme corp" are grouped; "ACME CORP SA" is a separate group

#### Scenario: Hybrid falls back to fuzzy when exact fails

- GIVEN transactions where no exact group meets min-occurrence threshold
- WHEN `clusterCandidates` is called with `{ mode: 'hybrid' }`
- THEN exact is attempted first, then fuzzy similarity is applied to remaining candidates

#### Scenario: Default mode preserves existing behavior

- GIVEN no `ClusterOptions` argument
- WHEN `clusterCandidates(config)` is called
- THEN clustering uses fuzzy mode (identical to pre-change behavior)

#### Scenario: requireRole filters output

- GIVEN candidates with roles PROVEEDOR and CLIENTE
- WHEN `clusterCandidates` is called with `{ requireRole: 'PROVEEDOR' }`
- THEN output contains only PROVEEDOR candidates

### Requirement: Backward Compatible Output Shape

Existing callers MUST receive the same return type regardless of mode. The `ClusterResult` shape (fields, types, nesting) SHALL NOT change.

#### Scenario: Caller unaffected by mode switch

- GIVEN code destructuring `{ entity, count, similarity }` from cluster results
- WHEN the same code calls `clusterCandidates` with `mode: 'exact'` instead of default
- THEN the destructured fields have identical keys and types

## MODIFIED Requirements

### Requirement: Entity Classifier Tests

`entity-classifier.ts` MUST have unit tests covering `getEntityCandidates`, `clusterCandidates` (all modes), and core classification logic. Tests MUST use Vitest with no external HTTP dependencies. Target coverage MUST be at least 70% for the classifier module.

(Previously: only `getEntityCandidates` was explicitly required)

#### Scenario: Known entity is found

- GIVEN EntityContext records exist with patterns matching transaction descriptions
- WHEN `getEntityCandidates` is called with transaction data for that company
- THEN the known entity MUST appear in the returned candidates

#### Scenario: Unknown pattern returns empty

- GIVEN no EntityContext records match any transaction descriptions
- WHEN `getEntityCandidates` is called
- THEN the returned candidates list MUST be empty

#### Scenario: Exact mode matches normalized keys

- GIVEN transactions "MERCADO A" and "mercado a"
- WHEN `clusterCandidates` is called with `{ mode: 'exact' }`
- THEN both are in the same cluster with count 2

#### Scenario: Mode produces different clusters on same data

- GIVEN a set of transactions with similar but not identical descriptions
- WHEN clustered with fuzzy mode AND with exact mode separately
- THEN the cluster count MAY differ between modes

## UNCHANGED AREAS

The following requirements from the main spec are NOT affected by this change: Shared Role Registry, Role Validation, Manual Entity Creation (UI), Manual Entity Creation (API). The `ScanPattern` output interface is identical.
