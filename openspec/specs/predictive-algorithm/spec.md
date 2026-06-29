# Delta for Predictive Algorithm

## ADDED Requirements

### Requirement: REQ-PRED-01 — Jaro-Winkler extracted to string-similarity.ts

The system MUST extract `jaroWinkler()` and its helper `jaro()` from `entity-detector.ts` into a new module at `src/lib/utils/string-similarity.ts`. The extracted functions MUST be bitwise-identical to the source implementation.

#### Scenario: Identical strings score 1.0

- GIVEN two identical strings `"MERCADO LIBRE"`
- WHEN `jaroWinkler` from `string-similarity.ts` is called
- THEN the result MUST be `1.0`

#### Scenario: Completely different strings score near 0

- GIVEN strings `"MERCADO LIBRE"` and `"ZZZZZZZZZZZZ"`
- WHEN `jaroWinkler` is called
- THEN the result MUST be `<= 0.1`

#### Scenario: Minor typo yields high similarity

- GIVEN strings `"MERCADO LIBRE"` and `"MERCADO LIBRE "` (trailing space)
- WHEN `jaroWinkler` is called
- THEN the result MUST be `>= 0.95`

#### Scenario: Short strings handled

- GIVEN strings `"AB"` and `"AC"`
- WHEN `jaroWinkler` is called
- THEN the result MUST be computed without error (no division by zero)

#### Scenario: Long strings with common prefix

- GIVEN strings `"EXPRESO ARGENTINO S.A."` and `"EXPRESO ARGENTINO S.R.L."`
- WHEN `jaroWinkler` is called
- THEN the result MUST be `> 0.85` (Jaro-Winkler bonus for common prefix)

### Requirement: REQ-PRED-02 — Re-exported from entity-detector.ts

`entity-detector.ts` MUST re-export `jaroWinkler` from `string-similarity.ts` for backward compatibility.

#### Scenario: Old import continues to work

- GIVEN existing code that imports `{ jaroWinkler }` from `entity-detector.ts`
- AFTER extraction to `string-similarity.ts`
- WHEN the existing import is executed
- THEN the function resolves correctly and returns identical results

### Requirement: REQ-PRED-03 — predictive-engine.ts uses Jaro-Winkler

The system MUST replace the Levenshtein distance function in `src/lib/reconciliation/predictive-engine.ts` with `jaroWinkler()` imported from `string-similarity.ts`. The match threshold MUST remain the same as before.

#### Scenario: Description match using Jaro-Winkler

- GIVEN a transaction description `"MERCADO LIBRE SA"` and a known pattern `"MERCADO LIBRE"`
- WHEN `predictive-engine` computes description similarity
- THEN it uses Jaro-Winkler similarity (not Levenshtein distance)

### Requirement: REQ-PRED-04 — Match quality equivalence on known fixtures

The Jaro-Winkler replacement MUST produce match quality equal to or better than the old Levenshtein on all known test fixtures.

#### Scenario: Known fixture produces same-or-better match

- GIVEN a recorded fixture of description pairs with known match results under Levenshtein
- WHEN the same pairs are evaluated with Jaro-Winkler
- THEN the match quality MUST be >= the recorded Levenshtein score for each pair

#### Scenario: Same entity different suffix still matches

- GIVEN patterns `"EXPRESO ARGENTINO SA"` and `"EXPRESO ARGENTINO SRL"`
- WHEN Jaro-Winkler similarity is computed
- THEN the similarity MUST be high enough to match as the same entity (Jaro-Winkler handles suffix differences better than Levenshtein)
