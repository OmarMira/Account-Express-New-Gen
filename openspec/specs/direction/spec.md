# Delta for Direction Thresholds

## ADDED Requirements

### Requirement: REQ-DIR-01 — `classifyDirection(profile)` with threshold >= 0.8

The system MUST provide a single exported function `classifyDirection(profile: DirectionProfile): 'debit' | 'credit' | 'mixed'` at `src/lib/services/direction-filter.ts`. When `debitPct >= 0.8` the result MUST be `'debit'`. When `creditPct >= 0.8` the result MUST be `'credit'`. Otherwise MUST return `'mixed'`. This answers "is this entity pure?".

#### Scenario: Pure debit classified

- GIVEN a DirectionProfile with `debitPct: 0.95, creditPct: 0.05`
- WHEN `classifyDirection` is called
- THEN it MUST return `'debit'`

#### Scenario: Pure credit classified

- GIVEN a DirectionProfile with `creditPct: 0.90, debitPct: 0.10`
- WHEN `classifyDirection` is called
- THEN it MUST return `'credit'`

#### Scenario: Mixed direction at boundary

- GIVEN a DirectionProfile with `debitPct: 0.79, creditPct: 0.21`
- WHEN `classifyDirection` is called
- THEN it MUST return `'mixed'`

#### Scenario: Exactly 0.8 boundary

- GIVEN a DirectionProfile with `debitPct: 0.80, creditPct: 0.20`
- WHEN `classifyDirection` is called
- THEN it MUST return `'debit'`

#### Scenario: Zero-profile edge case

- GIVEN a DirectionProfile with `debitPct: 0, creditPct: 0`
- WHEN `classifyDirection` is called
- THEN it MUST return `'mixed'`

### Requirement: REQ-DIR-02 — `majorityDirection(profile)` with threshold > 0.5

The system MUST provide `majorityDirection(profile: DirectionProfile): 'debit' | 'credit' | null` answering "what's the majority?". Returns `'debit'` when `debitPct > 0.5`, `'credit'` when `creditPct > 0.5`, and `null` when neither exceeds 0.5.

#### Scenario: Majority debit

- GIVEN a DirectionProfile with `debitPct: 0.55, creditPct: 0.45`
- WHEN `majorityDirection` is called
- THEN it MUST return `'debit'`

#### Scenario: Majority credit

- GIVEN a DirectionProfile with `debitPct: 0.40, creditPct: 0.60`
- WHEN `majorityDirection` is called
- THEN it MUST return `'credit'`

#### Scenario: No majority (equal)

- GIVEN a DirectionProfile with `debitPct: 0.50, creditPct: 0.50`
- WHEN `majorityDirection` is called
- THEN it MUST return `null`

#### Scenario: No majority (both low)

- GIVEN a DirectionProfile with `debitPct: 0.30, creditPct: 0.30`
- WHEN `majorityDirection` is called
- THEN it MUST return `null`

## REMOVED Requirements

### Requirement: `directionLockThreshold` from detection config

(Reason: Unused configuration parameter. The threshold `0.90` was never referenced by any active code path.)
(Migration: Remove `directionLockThreshold` field from `rules/entity-detection.json` and any config schema definitions.)
