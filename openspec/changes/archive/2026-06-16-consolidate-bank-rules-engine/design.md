# Design: Consolidate Bank Rules Engine

## Technical Approach

Refactor `rule-matching-engine.ts` as the canonical matching engine. `import.service.ts` delegates to it instead of running its own private matching. Add a `findMatchingRule()` high-level function that loads entity context, filters matching rules, scores by role priority, and resolves the winning GL account. Apply-all reads a new `Company.maxApplyTransactions` cap and returns a warning on overflow. Add name uniqueness check to PUT.

## Architecture Decisions

### Decision: Unified engine location

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Move all logic to a new file | Clean break, but breaks existing imports from engine | **Rejected** — too much churn |
| Refactor engine + delegate from import.service | Preserves existing API, minimal import changes | **Selected** |

`rule-matching-engine.ts` already exports `transactionMatchesRule()` and `evaluateWinningRule()` used by route handlers. The new `findMatchingRule(tx, rules, companyId)` combines both with entity-context loading. `import.service.ts` replaces its private `applyBankRule()` with a call to this function. `entity-classifier.ts` has no diverging match logic — its `getEntityCandidates()` checks rule coverage differently (substring containment), so it stays as-is.

### Decision: async loadRolePriorities with TTL cache

| Option | Tradeoff | Decision |
|--------|----------|----------|
| readFileSync with cached variable | Blocks event loop on first call | **Rejected** — violates spec |
| fs.promises.readFile + 5-min TTL | Async, capped staleness | **Selected** |
| Read from DB | No staleness, but reads on every apply-all | **Rejected** — role data is static |

Module-level variable `let cachedRolePriorities: { data, timestamp }` with a 5-minute TTL. Export as `loadRolePriorities(): Promise<Record<string, number>>`. Path kept as `const ROLE_PRIORITIES_PATH = join(process.cwd(), 'rules/entity-roles.json')`.

### Decision: PUT deduplication

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Add unique constraint on [companyId, name] | DB-level, but breaks name edits (no NOT: [id]) | **Rejected** — can't update name |
| findFirst check before upsert | Application-level, handles update correctly | **Selected** |

Add a `findFirst({ where: { companyId, name, NOT: { id } } })` check in `PUT /api/bank-rules/[id]` before the update call. Returns 409 with `t('bankRules.errors.duplicateName')`.

### Decision: Configurable cap

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Company setting table | Normalized, but adds a table | **Rejected** — simpler on Company |
| `maxApplyTransactions Int?` on Company | Single nullable field, null = unlimited | **Selected** |

Prisma field `maxApplyTransactions Int?` on Company model. `0` blocks all, `null` is unlimited. Apply-all reads it via `db.company.findUnique({ where: { id: companyId }, select: { maxApplyTransactions: true } })`.

## Data Flow

```
apply-all (POST)
  → GET company cap → fetch unmatched txs
  → if count > cap: truncate, set warning flag
  → for each tx: findMatchingRule(tx, rules, companyId)
    → loadEntityFirstContext → filter via transactionMatchesRule
    → score via evaluateWinningRule (role priorities)
    → return { rule, glAccountId }
  → UPDATE batched per winner → response { matched, total, warning? }

import.service importTransactions
  → fetch rules → for each tx: engine.findMatchingRule()
  → returns { matchedRuleId, glAccountId } — replaces old applyBankRule()

PUT /api/bank-rules/[id]
  → findFirst(companyId, name, NOT: id) → 409 if exists
  → prisma.bankRule.update(...)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/services/rule-matching-engine.ts` | Modify | Add `findMatchingRule()`, async `loadRolePriorities()` with TTL |
| `src/lib/services/import.service.ts` | Modify | Remove private `matchCondition()`/`applyBankRule()`, delegate to engine |
| `src/app/api/bank-rules/[id]/route.ts` | Modify | Add duplicate name check before update |
| `src/app/api/bank-rules/apply-all/route.ts` | Modify | Read cap, truncate, return warning; use async loadRolePriorities |
| `prisma/schema.prisma` | Modify | Add `maxApplyTransactions Int?` to Company model |
| `src/i18n/locales/es.ts` | Modify | Add `bankRules.applyAll.capWarning`, `bankRules.errors.duplicateName` |
| `src/i18n/locales/en.ts` | Modify | Same keys in English |
| `tests/services/rule-matching-engine.test.ts` | Modify | Add tests for `findMatchingRule()` |
| `tests/integration/bank-rules-consolidation.test.ts` | Create | Integration tests for PUT dedup, apply-all cap, import delegation |

## Key Interfaces

```typescript
// New export from rule-matching-engine.ts
export interface MatchResult {
  matchedRuleId: string | null;
  glAccountId: string | null;
}

// High-level matching — used by import.service and route handlers
export async function findMatchingRule(
  tx: Transaction,
  rules: MatchingRule[],
  companyId: string,
): Promise<MatchResult>;

// Async replacement for synchronous loadRolePriorities
export async function loadRolePriorities(): Promise<Record<string, number>>;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `findMatchingRule()`: normalized match, priority scoring, wildcard, no match, entity-first conflict | Pure engine tests (no DB), same pattern as existing `tests/services/rule-matching-engine.test.ts` |
| Integration | PUT duplicate name → 409; same name different company → success | Use existing test factories (`createTestUser`, `createTestCompany`, `createTestGlAccount`) and `NextRequest` |
| Integration | Apply-all with cap=0 → 0 applied + warning; cap=5, 12 pending → 5 applied + warning; cap=null → unlimited | Full DB roundtrip via `POST /api/bank-rules/apply-all` |
| Integration | Import service still categorizes correctly after delegation | Verify `importTransactions` returns same `autoCategorizedCount` |
| Check | Response payload includes `warning` key when cap exceeded, absent when not | Assert `response.warning === undefined` for in-cap, `response.warning` defined for overflow |

Tests use `bun x vitest` with the existing `tests/setup.ts` (forces test.db, mocks Z AI SDK). Integration tests follow the `bank-rules-fase3.test.ts` pattern: `clearDatabase()` in beforeEach, create user + company + session, fake `NextRequest` with Authorization header.

## Migration

No data migration. The `maxApplyTransactions` field is additive and nullable — existing rows have `null` (unlimited). The engine refactor is pure logic change; existing rules and transactions are unaffected.
