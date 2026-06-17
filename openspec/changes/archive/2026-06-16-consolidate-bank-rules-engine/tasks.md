# Tasks: Consolidate Bank Rules Engine

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450–550 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Engine + i18n + unit tests → PR 2: Schema + routes + integration tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Core engine refactor + i18n keys + unit tests | PR 1 (base: main) | Independent — no schema change needed |
| 2 | Schema + routes (PUT dedup, apply-all cap, import delegation) + integration tests | PR 2 (base: main) | Depends on engine but no code dependency on PR 1; parallelizable with coordination |

## Phase 1: Foundation — Schema + i18n

- [x] 1.1 Add `maxApplyTransactions Int?` to Company model in `prisma/schema.prisma`
- [x] 1.2 Add `bankRules.applyAllCapWarning` (flat key) and `bankRules.errors.duplicateName` keys to `src/i18n/locales/es.ts`
- [x] 1.3 Add same keys to `src/i18n/locales/en.ts`

## Phase 2: Core Engine Refactor

- [x] 2.1 Add `loadRolePriorities()` with async TTL cache (5-min, fs.promises) in `rule-matching-engine.ts`
- [x] 2.2 Export `MatchResult` interface and `findMatchingRule()` combining entity-context loading, filtering, priority scoring
- [x] 2.3 Normalize string comparisons (lowercase + trim + whitespace collapse) inside `transactionMatchesRule()`

## Phase 3: Integration — Delegation + Routes

- [x] 3.1 Replace private `applyBankRule()`/`matchCondition()` in `import.service.ts` with call to `engine.findMatchingRule()`
- [x] 3.2 Add `findFirst({ companyId, name, NOT: { id } })` duplicate check → 409 in `PUT /api/bank-rules/[id]/route.ts`
- [x] 3.3 Read `maxApplyTransactions` cap in `apply-all/route.ts`, truncate pending txs, return `warning` via `t('bankRules.applyAllCapWarning')`

## Phase 4: Testing

- [x] 4.1 Unit: `findMatchingRule()` — normalized match, priority scoring, wildcard, no match, empty condition skip
- [x] 4.2 Integration: PUT dedup — same name 409, same name different company 200
- [x] 4.3 Integration: apply-all cap — null (unlimited), 0 (blocked), overflow (capped + warning), exact (no warning)
- [x] 4.4 Integration: import delegation preserves `autoCategorizedCount` parity with old logic
