# Design: Improve Entity Classifier

## Technical Approach

Four independent concerns stacked on the existing `suggest-role` pipeline: (1) hard filter before AI call, (2) richer prompt payload, (3) OTRO persistence via schema+service, (4) optional web fallback. No new routes — all changes are additive within existing handlers and services.

## Data Flow

```
POST /api/learning/suggest-role
  │
  ├── 1. Local DB search (existing, unchanged)
  │
  ├── 2. Direction Hard Filter (NEW)
  │   │   roleIsValidForDirection(role, directionProfile) → { valid, reason? }
  │   │   Filters candidate roles BEFORE sending to AI
  │   │   Bypasses: SOCIO, OTRO, IGNORADA
  │   │
  ├── 3. Rich AI Prompt (MODIFIED)
  │   │   Includes directionProfile, samples, amount range, blocked roles
  │   │
  ├── 4. Web Search Fallback (NEW, opt-in)
  │   │   If AI confidence < 80% AND WEB_SEARCH_ENABLED
  │   │   → searchEntity(name) → re-prompt AI → cap at 0.70
  │   │
  └── 5. Response (existing shape)

POST /api/learning/classify-entity
  │
  ├── OTRO + userDescription → save EntityContext with role:"OTRO" (MODIFIED)
  ├── Non-OTRO → same as before
  └── userDescription persisted via entity-context-service (MODIFIED)

GET /api/learning/classify-entity (getEntityCandidates)
  └── Skips entities with OTRO EntityContext (MODIFIED)
```

## Architecture Decisions

### ADR-1: 80% threshold for direction filter

| Option | Tradeoff | Decision |
|--------|----------|----------|
| 100% (pure only) | Misses entities with near-pure profiles (e.g., 95/5) — too conservative | ❌ |
| 50% (simple majority) | Block flip-flops on slight majorities (51/49) — too aggressive | ❌ |
| **80%** | 4:1 ratio is decisive; catches dominant profiles without false positives on barely-mixed | ✅ Chosen |

Rationale: Matches the existing frontend `checkRoleDirectionMismatch` which uses >70% for *warning* but not blocking. 80% is intentionally 10pp higher for blocking — the hard filter is more restrictive. Tuneable after real-world validation.

### ADR-2: Web search opt-in via env var

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Always on | Unexpected API costs; PII sent without explicit consent | ❌ |
| **Opt-in (`WEB_SEARCH_ENABLED`)** | Zero cost by default; explicit configuration required | ✅ Chosen |
| Per-company toggle | More complex configuration surface | ❌ |

Rationale: Google Custom Search free tier is 100 queries/day. Opt-in ensures teams explicitly choose to consume that quota. PII risk is mitigated by sending only the entity canonicalName, not raw transaction descriptions.

### ADR-3: OTRO persisted instead of discarded

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Discard OTRO (current) | Entity re-appears every scan, user frustration | ❌ |
| **Persist OTRO + description** | Entity disappears from candidates; user can bulk-reclassify later | ✅ Chosen |
| Save OTRO without description | No signal for later reclassification | ❌ |

Rationale: OTRO with a user description is valuable signal. The entity disappears from the onboarding flow immediately. A future "OTRO review" view lets users reclassify batches when they have more context. The 5-char minimum on description prevents noise saves.

### ADR-4: Google Custom Search over other providers

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Google Custom Search** | 100 free queries/day, well-documented API, 5s timeout | ✅ Chosen |
| Bing Web Search | Different auth model, less familiar | ❌ |
| SerpAPI | Paid from first query | ❌ |
| Built-in (no provider) | No fallback at all | ❌ |

Rationale: GCS is the most widely available free-tier web search API. The adapter pattern (`web-search-service.ts`) makes swapping providers trivial — only the `fetch` call changes.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/services/direction-filter.ts` | **Create** | `roleIsValidForDirection()` pure function |
| `src/lib/services/web-search-service.ts` | **Create** | Google Custom Search adapter |
| `src/app/api/learning/suggest-role/route.ts` | **Modify** | Add direction filter, rich prompt, web search fallback |
| `src/app/api/learning/classify-entity/route.ts` | **Modify** | Accept `userDescription`, pass to saveContext |
| `src/lib/services/entity-context-service.ts` | **Modify** | Add `userDescription` to `saveContext()` input and upsert |
| `src/lib/services/entity-classifier.ts` | **Modify** | `getEntityCandidates()` skips OTRO contexts |
| `src/components/learning/EntityOnboardingModal.tsx` | **Modify** | `handleClassifyAll()` saves OTRO with description; `handleAcceptSuggestion()` updates context |
| `prisma/schema.prisma` | **Modify** | Add `userDescription String?` to EntityContext |
| `prisma/migrations/*_add_user_description` | **Create** | Prisma migration |
| `tests/services/direction-filter.test.ts` | **Create** | FR-1 full coverage |
| `tests/services/suggest-role.test.ts` | **Create** | FR-2 + FR-4 (mock AI) |
| `tests/services/otro-persistence.test.ts` | **Create** | FR-3 save/load/skip |
| `tests/services/web-search-service.test.ts` | **Create** | FR-4 mock fetch |

## Interfaces / Contracts

### Direction Filter

```typescript
// src/lib/services/direction-filter.ts
interface FilterResult {
  valid: boolean;
  reason?: string;
}

function roleIsValidForDirection(
  role: EntityRole,
  profile: { creditPct: number; debitPct: number }
): FilterResult
```

Logic:
1. If role is SOCIO, OTRO, or IGNORADA → `{ valid: true }`
2. If `creditPct >= 0.80` → treat as pure-credit → reject roles with `EXPECTED_DIRECTION === 'debit'`
3. If `debitPct >= 0.80` → treat as pure-debit → reject roles with `EXPECTED_DIRECTION === 'credit'`
4. Otherwise (mixed) → `{ valid: true }`

### Web Search Service

```typescript
// src/lib/services/web-search-service.ts
interface SearchResult {
  title: string;
  snippet: string;
  sourceUrl: string;
}

interface WebSearchConfig {
  enabled: boolean;    // process.env.WEB_SEARCH_ENABLED === 'true'
  apiKey: string;      // process.env.WEB_SEARCH_API_KEY
  engineId: string;    // process.env.WEB_SEARCH_ENGINE_ID
}

async function searchEntity(entityName: string): Promise<SearchResult | null>
// Uses AbortController with 5s timeout. Returns null on timeout or error.
```

### OTRO Persistence

```typescript
// saveContext input — ADDED field
interface SaveContextInput {
  // ...existing fields
  userDescription?: string;  // NEW: only for OTRO saves
}

// EntityContext Prisma model — ADDED field
// userDescription String?
```

### suggest-route Input (extended)

```typescript
// POST /api/learning/suggest-role — ADDED fields
interface SuggestRoleInput {
  description: string;
  companyId?: string;
  // NEW:
  directionProfile?: { creditPct: number; debitPct: number };
  sampleDescriptions?: string[];
  totalAmount?: number;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `roleIsValidForDirection` | All 11 roles × 3 profiles (pure-credit, pure-debit, mixed) + threshold edge (79%) |
| Unit | Web search: success, timeout, disabled, missing key | Mock `fetch` + `AbortController` |
| Unit | OTRO: save with/without description, skip in candidates, accept suggestion update | Mock `db` and `saveContext` |
| Integration | `suggest-role` rich prompt construction | Mock AI endpoint, verify prompt string contains direction labels |

## Migration / Rollout

- **Schema**: Run `npx prisma migrate dev --name add_user_description` — optional field, no backfill needed.
- **Web search**: Feature-flagged via `WEB_SEARCH_ENABLED` (default `false`). Zero impact if unset.
- **Direction filter**: Active immediately. If edge cases surface, threshold is a single constant change.
- **Rollback**: Revert schema + down migration, revert suggest-role prompt, revert modal OTRO save path.

## Open Questions

- [x] OTRO review view: should it be a dedicated page or a modal extension? **Resuelto:** ya existe EntityManagementPage que lista todas las entidades y permite re-clasificar. Se agregó columna `userDescription`.
- [x] Web search rate limit handling: if daily quota exhausted, should we log and silently skip or surface to user? **Resuelto:** log and skip (implementado así en T-14).
