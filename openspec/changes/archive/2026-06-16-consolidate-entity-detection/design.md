# Design: Consolidate Entity Detection Engines

## Technical Approach

Merge the two parallel detection engines into one by adding a `mode` parameter to `clusterCandidates()` (exact = normalize+count, fuzzy = Jaro-Winkler), extracting enrichment logic into a standalone `entity-enricher.ts` module, and refactoring `scan/route.ts` into a thin orchestrator that calls the unified engine + enricher.

```
┌─────────────────────────────────────────────────────────────────┐
│                    scan/route.ts (thin)                         │
│  fetch txs ──→ clusterCandidates(mode:'exact') ──→ enrich ──→  │
│                    ScanPattern[] response                        │
└─────────────────────────────────────────────────────────────────┘
         │                                  ▲
         ▼                                  │
┌────────────────────┐    ┌──────────────────────────────┐
│ entity-detector.ts │    │    entity-enricher.ts         │
│  clusterCandidates │───→│  suggestGlAccount()           │
│  (mode: fuzzy|     │    │  resolveContextRole()          │
│         exact)     │    │  enrichCandidates()            │
│  extractName()     │    │  (pure functions)              │
│  sanitize...()     │    └──────────────────────────────┘
└────────────────────┘
```

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| `ClusterOptions` location | Separate param / merged into config | New optional 2nd param `ClusterOptions` | `EntityDetectionConfig` is JSON-loaded, `ClusterOptions` is caller-supplied. Backward compat: omitting = fuzzy with config defaults. |
| Scan options (smartFreq, numberStrip, requireRole) | In ClusterOptions / separate ScannerOptions | Inside `ClusterOptions` | Single options object simplifies the API. Defaults to `false` so existing callers get current fuzzy behavior. |
| `hybrid` mode | Include now / defer | Omit from Phase 2 | No clear use case yet. Adding `'hybrid'` to the union later is non-breaking. |
| Enricher shape | Class / namespace / pure functions | Pure functions (default export object) | Stateless, testable, no DI needed. Matches existing `pattern-normalizer.ts` style. |
| Context matching standard | Scan's inline normalize / `normalizePattern` | Adopt `normalizePattern` from pattern-normalizer | Already shared, already used by `entity-context-service.ts`. Scan's inline normalize does less (no prefix stripping). |
| `EntityCandidate` vs `ScanPattern` | Unify / keep separate | Keep separate, enrich `EntityCandidate` with enrichment fields | `ScanPattern` used by ConversationalRuleBuilder — changing it risks breakage. `EntityCandidate` gains `contextRole`, `suggestedAccount*` as optional fields. |
| Enricher input contexts | Fetch inside enricher / receive as param | Receive as param (DI) | Keeps functions pure; caller decides what contexts to pass. Matches existing pattern where route fetches data. |

## Data Flow

```
POST /api/ai-rules/scan
  │
  ├─ 1. Fetch bankAccounts + transactions + glAccounts + entityContexts + existingRules
  │
  ├─ 2. clusterCandidates(transactions, config, { mode: 'exact', extraNumberStrip: true })
  │      └─ For each tx:
  │           sanitizeDescription() → extractName() → normalize key (exact)
  │           OR jaroWinkler() match (fuzzy)
  │         → EntityCandidate[]
  │
  ├─ 3. enrichCandidates(candidates, entityContexts, glAccounts, existingRules)
  │      └─ For each candidate:
  │           resolveContextRole() → match via normalizePattern().includes()
  │           → apply smartFrequency filter (context ? 1 : 2)
  │           → apply requireRole filter (skip if no context)
  │           → suggestGlAccount(context, ROLE_ACCOUNT_MAP, glAccounts, isDebit)
  │           → skipExistingRule(candidate, existingRules)
  │         → enriched EntityCandidate[]
  │
  └─ 4. Map enriched candidates to ScanPattern[] → JSON response
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/services/entity-detector.ts` | Modify | Add `ClusterOptions` param to `clusterCandidates()`. Implement `'exact'` mode. Export `ClusterOptions` interface. |
| `src/lib/services/entity-enricher.ts` | Create | Pure enrichment functions: `resolveContextRole`, `suggestGlAccount`, `enrichCandidates`, `buildScanPattern`. |
| `src/app/api/ai-rules/scan/route.ts` | Modify | Strip enrichment logic. Call `clusterCandidates(mode:'exact')` + enricher. Keep DB fetches + response formatting. |
| `tests/services/entity-detector.test.ts` | Modify | Add exact mode test cases alongside existing fuzzy tests. |
| `tests/services/entity-enricher.test.ts` | Create | Unit tests for all enricher functions. |
| `tests/services/scan-route.test.ts` | Create | Integration test for the refactored scan route. |

## Interfaces

```typescript
// ── entity-detector.ts (new export) ──

export interface ClusterOptions {
  mode?: 'fuzzy' | 'exact';
  threshold?: number;          // Jaro-Winkler threshold (fuzzy only)
  minOccurrences?: number;     // override config.validation.minOccurrences
  minLength?: number;          // override config.clustering.minLength
  smartFrequency?: boolean;    // if true: 1 if has context, else minOccurrences
  extraNumberStrip?: boolean;  // strip numbers from extracted name before keying
  requireRole?: boolean;       // exclude candidates without a resolved context role
}

// Updated signature (backward compatible):
export function clusterCandidates(
  transactions: BankTransactionRaw[],
  config: EntityDetectionConfig,
  options?: ClusterOptions,
): EntityCandidate[];
```

```typescript
// ── entity-enricher.ts (new file) ──

import type { EntityCandidate } from './entity-detector';
import type { EntityContextWithGlAccount } from '@/lib/types/entity-context';

export interface EnrichmentInput {
  contexts: EntityContextWithGlAccount[];
  glAccounts: Array<{ id: string; name: string; code: string; accountType: string }>;
  rolePriorities?: Record<string, number>;
  knownSocioPatterns?: string[];
}

export interface EnrichedCandidate extends EntityCandidate {
  hasContext: boolean;
  contextRole: string;
  suggestedAccountName: string;
  suggestedAccountCode: string;
  suggestedAccountId: string;
}

export function resolveContextRole(
  candidate: EntityCandidate,
  description: string,
  input: EnrichmentInput,
): EntityContextWithGlAccount | null;

export function suggestGlAccount(
  context: EntityContextWithGlAccount | null,
  isDebit: boolean,
  glAccounts: EnrichmentInput['glAccounts'],
): { name: string; code: string; id: string } | null;

export function enrichCandidates(
  candidates: EntityCandidate[],
  descriptions: Map<string, string>,  // entityKey → raw sample
  input: EnrichmentInput,
  options?: { requireRole?: boolean; smartFrequency?: boolean },
): EnrichedCandidate[];
```

```typescript
// ── scan/route.ts — ScanPattern stays identical ──

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

## Migration Path

Three-step, no breaking changes between steps:

1. **Add mode param**: `clusterCandidates` gains optional `ClusterOptions`. Default mode=`'fuzzy'` — existing callers unchanged. Exact mode implemented.
2. **Create enricher**: New `entity-enricher.ts` with pure functions. Scan route unchanged at this point.
3. **Refactor scan route**: Strip enrichment, call unified `clusterCandidates(mode:'exact')` + `enrichCandidates()`. Output `ScanPattern` shape identical.

Each step is independently deployable. Rollback: revert steps in reverse order.

## Performance Considerations

| Factor | Impact | Mitigation |
|--------|--------|------------|
| Exact mode O(n) vs Fuzzy O(n*m) | Exact is significantly faster | Mode selection per use case. Scan uses exact. |
| Enrichment loops over all candidates | O(candidates × contexts) | Contexts are typically small (5–50 per company). No per-tx overhead — enrichment runs per candidate, not per tx. |
| `normalizePattern` call per candidate | Cheap (< 1μs) | Pure string ops, no allocations beyond the result. |
| Extra number strip pass | Cheap | Single regex replace per extracted name. |

Jaro-Winkler remains O(n*m) on string length for fuzzy mode, but this was already the baseline. Exact mode eliminates it entirely for scan.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `clusterCandidates` exact mode | Same tx sets as fuzzy but expects exact key grouping. ≥5 real tx sets from proposal. |
| Unit | `resolveContextRole` | Context match via `normalizePattern().includes()`. Test conflict detection (SOCIO filter). |
| Unit | `suggestGlAccount` | Test: context with glAccount, context with ROLE_ACCOUNT_MAP, no context (heuristic fallback). |
| Unit | `enrichCandidates` | Pipeline: empty candidates, mixed, all filtered by requireRole. |
| Integration | Scan route refactor | Mock DB, call POST, assert `ScanPattern[]` shape identical to current output on same data. |

No E2E needed — no UI changes.

## Open Questions

- [ ] Hybrid mode: fuzzy-first then exact fallback? Skip for now — explicit mode per caller is simpler.
- [ ] Should `enrichCandidates` handle the `entityFirstCheck` SOCIO conflict or keep that in the route? Keep in route — it's scan-specific detection, not general enrichment.
