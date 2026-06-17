# Exploration: Entity Classifier Improvements

> **Date**: 2026-06-16
> **Project**: AccountExpress (sistema)
> **Topic**: entity-classifier-improvements
> **Mode**: hybrid (Engram + filesystem)

---

## Current State

### Architecture Overview

The entity classifier system spans 4 layers:

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer                                                    │
│  ┌─────────────────────┐  ┌───────────────────────────────┐  │
│  │ EntityOnboardingModal│  │ ContextClarificationModal     │  │
│  │ (Bulk classification)│  │ (Single entity during ops)    │  │
│  └─────────────────────┘  └───────────────────────────────┘  │
│  ┌─────────────────────┐  ┌───────────────────────────────┐  │
│  │ ConversationalRule   │  │ EntityManagementPage          │  │
│  │ Builder              │  │ (CRUD list view)              │  │
│  └─────────────────────┘  └───────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  API Layer                                                   │
│  POST/GET /api/learning/classify-entity                      │
│  POST   /api/learning/conversational-parse                   │
│  POST   /api/learning/rules                                  │
│  POST   /api/ai-rules/scan                                   │
│  GET    /api/entity-context (list)                           │
│  PATCH  /api/entity-context/[id]                             │
│  DELETE /api/entity-context/[id]                             │
├─────────────────────────────────────────────────────────────┤
│  Service Layer                                               │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │ entity-classifier.ts │  │ entity-detector.ts           │  │
│  │ (classifyEntity,     │  │ (clusterCandidates,          │  │
│  │  getEntityCandidates)│  │  extractName, jaroWinkler)   │  │
│  └──────────────────────┘  └──────────────────────────────┘  │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │ conversational-      │  │ entity-context-crud.         │  │
│  │ service.ts           │  │ service.ts                   │  │
│  │ (parseConversational │  │ (list, update, bulkDelete)   │  │
│  │  Context, AI parser) │  │                              │  │
│  └──────────────────────┘  └──────────────────────────────┘  │
│  ┌──────────────────────┐                                     │
│  │ rule-matching-       │                                     │
│  │ engine.ts            │                                     │
│  │ (entityFirstCheck)   │                                     │
│  └──────────────────────┘                                     │
├─────────────────────────────────────────────────────────────┤
│  Data Layer (Prisma)                                         │
│  EntityContext { pattern, role, roles, glAccountId }         │
│  BankRule { conditions, conditionValue, glAccountId, ... }   │
│  BankTransaction { description, amount, matchedRuleId }      │
│  GlAccount { code, name, accountType, parentId }             │
└─────────────────────────────────────────────────────────────┘
```

### How `getEntityCandidates()` Works

1. Fetches all active bank accounts for the company
2. Fetches up to 2000 transactions across those accounts
3. Loads `entity-detection.json` config from disk
4. Calls `clusterCandidates(raw, config)` which:
   - Sanitizes descriptions (strips IDs, dates, amounts)
   - Extracts entity names using priority strategies (P1: merchant, P2: from/to, P3: INDN)
   - Groups similar names via Jaro-Winkler fuzzy matching (threshold: 0.85)
   - Filters by minimum occurrences (default: 2)
5. Loads existing `EntityContext` records and filters out already-classified patterns
6. Loads existing `BankRule` records and filters out patterns already covered by rules
7. Returns remaining unclassified `EntityCandidate[]`

### How Entities Are Detected During Import

- `import.service.ts` calls `findMatchingRule()` for each transaction during import
- `rule-matching-engine.ts` loads `EntityContext` to match descriptions against known patterns
- There is **no automatic entity detection during import** — entities are only detected when the user explicitly opens the onboarding modal or rule builder

### The "Other" / Manual Entry Problem

**Root cause identified:** The `rules/entity-roles.json` file contains only 5 roles:

```json
["INQUILINO", "PROVEEDOR", "SOCIO", "CLIENTE", "EMPLEADO"]
```

The `EntityOnboardingModal.tsx` sources its dropdown from this file (line 25):

```tsx
import entityRoles from '../../../rules/entity-roles.json';
// ...
{entityRoles.map((r) => ( <SelectItem key={r} value={r}>{r}</SelectItem> ))}
```

**However**, the modal already has code to handle the "OTRO" role with a custom input (lines 241-250):

```tsx
{role === 'OTRO' && (
  <Input placeholder={t('learning.customRoleName')} ... />
)}
```

And the `handleClassifyAll` function already uses custom role input when role is 'OTRO' (line 113):

```tsx
const finalRole = sel.role === 'OTRO' ? (sel.userInput || '').trim().toUpperCase() : sel.role;
```

**The bug:** 'OTRO' is simply **missing from the dropdown options** because `entity-roles.json` doesn't include it. The "other" option is fully coded but invisible to the user.

Meanwhile, `EntityManagementPage.tsx` has its own hardcoded `ROLES` constant with 11 roles including 'OTRO':

```tsx
const ROLES = [
  { value: 'INQUILINO', key: 'entityManagement.role.INQUILINO' },
  { value: 'PROVEEDOR', key: 'entityManagement.role.PROVEEDOR' },
  // ... TARJETA_CREDITO, PRESTAMO, GASTO_OPERATIVO, INGRESO, OTRO, IGNORADA
];
```

### Two Parallel Detection Engines

| Aspect | `entity-detector.ts` | `ai-rules/scan/route.ts` |
|--------|---------------------|--------------------------|
| Algorithm | Jaro-Winkler fuzzy clustering | Simple normalize + count |
| Threshold | 0.85 similarity | Exact match after normalize |
| Min occurrences | 2 (configurable) | 3 (hardcoded) |
| Used by | `EntityOnboardingModal` | `ConversationalRuleBuilder` |
| Context filtering | Excludes classified + ruled | Excludes only if no context |
| Output | `EntityCandidate[]` with direction profile | `ScanPattern[]` with suggestions |

These two engines can produce **different candidates** for the same transaction set, leading to inconsistent user experiences.

---

## Pain Points

### 1. Missing "Other" Role (#1 bug)
- `entity-roles.json` is incomplete — missing TARJETA_CREDITO, PRESTAMO, GASTO_OPERATIVO, INGRESO, OTRO, IGNORADA
- OTRO handling code exists but never renders because the option isn't in the dropdown
- The `ContextClarificationModal` has the same problem (imports from same file)

### 2. No Manual Entity Entry
- There is no "Add Entity" button anywhere in the UI
- If the clustering algorithm misses an entity, users cannot manually create one
- `EntityManagementPage` is read-only (list + edit + delete only, no create)
- Users must wait for transactions to accumulate enough occurrences before classification

### 3. Inconsistent Role Sources
- `entity-roles.json` (5 roles): used by EntityOnboardingModal, ContextClarificationModal
- `EntityManagementPage.tsx` ROLES constant (11 roles): used by management page
- `ROLE_ACCOUNT_MAP` (9 roles): used by conversational-service, rule creation
- `entity-context validation schema` (any string): no role validation at all
- No single source of truth for available roles

### 4. No Test Coverage for Core Path
- `entity-classifier.ts` (the main classifer): **ZERO tests**
- `entity-detector.ts`: 2 test files (114 + 270 lines) — good coverage for extraction/clustering
- `entity-context-service.ts`: **ZERO tests**
- `conversational-service.ts`: **ZERO tests**
- No tests for the "other" / custom role flow

### 5. Coupling with Bank Rules
- `getEntityCandidates()` also queries BankRules to exclude covered patterns
- `learning/rules/route.ts` upserts EntityContext when creating a rule
- `rule-matching-engine.ts` loads EntityContext during matching
- Changes to entity classification directly affect rule matching and vice versa

### 6. Silent Candidate Filtering
- `getEntityCandidates()` filters out patterns that match ANY existing rule, even low-priority ones
- No indication to the user WHY an entity is not shown as a candidate
- If a generic rule catches a pattern, the entity is invisible forever

---

## Affected Areas

| File | Why Affected |
|------|-------------|
| `rules/entity-roles.json` | Missing OTRO and other roles; needs full role set |
| `src/components/learning/EntityOnboardingModal.tsx` | OTRO flow coded but dropdown never shows it; needs manual entity add |
| `src/components/learning/ContextClarificationModal.tsx` | Same role sourcing issue; uses outdated entity-roles.json |
| `src/components/spa/EntityManagementPage.tsx` | No create/add entity action; hardcoded ROLES list duplicates config |
| `src/lib/services/entity-classifier.ts` | No manual entity creation path; no tests |
| `src/lib/services/entity-detector.ts` | Two parallel engines with different results |
| `src/lib/services/entity-context-service.ts` | No tests; validation schema accepts any role string |
| `src/lib/services/conversational-service.ts` | Complex coupling with AI parser + heuristic fallback; no tests |
| `src/lib/constants/role-account-map.ts` | Hardcoded role-to-account mapping — source of truth? |
| `src/lib/validations/entity-context.ts` | No role enum validation — any string passes |
| `src/app/api/ai-rules/scan/route.ts` | Second detection engine with different algorithm |
| `src/app/api/learning/classify-entity/route.ts` | Only processes detected candidates, no manual creation |
| `src/i18n/locales/es.ts` | Entity-related keys for learning + entityManagement sections |
| `src/i18n/locales/en.ts` | Entity-related keys for learning + entityManagement sections |

---

## Approaches

### Option A: Fix the "Other" Option (Minimal Fix)

**What:** Fix the single bug that makes OTRO invisible.

**Changes:**
1. Add all 11 roles to `rules/entity-roles.json`
2. (Optional) Sync role source between components — either all use entity-roles.json or all use a shared constant

**Pros:**
- Minimal effort (1 file change)
- Fixes the reported bug immediately
- Zero risk of regression
- OTRO custom input already works once the option is in the dropdown

**Cons:**
- Does NOT add manual entity entry
- Does NOT address the two parallel engines
- Does NOT add test coverage
- Does NOT fix the "no create" gap in EntityManagementPage
- Role list still duplicated across multiple sources

**Effort:** Low (1 hour)

---

### Option B: Full Entity Classification Overhaul (Comprehensive)

**What:** Modeled after the bank rules consolidation — create a unified entity classification engine with specs, tests, and proper architecture.

**Changes:**
1. **Unified engine**: Merge `entity-detector.ts` and `ai-rules/scan` logic into one canonical `entity-classifier-engine.ts`
2. **Role registry**: Replace `entity-roles.json` + hardcoded ROLES + ROLE_ACCOUNT_MAP with a single registry (Zod enum + JSON config)
3. **Manual entity creation**: Add "Add Entity" flow to EntityManagementPage + API endpoint
4. **OTRO fix**: Include OTRO in the role registry (covered by #2)
5. **Validation**: Add role enum validation to `entity-context.ts` schema
6. **Tests**: Unit tests for classifier, integration tests for the full flow
7. **i18n**: Add missing keys for manual entity creation
8. **Consolidate candidate filtering**: Clear rules for when an entity is shown vs hidden, with feedback to the user

**Pros:**
- Solves the root cause, not just the symptom
- Single source of truth for roles
- Consistent detection across all entry points
- Proper test coverage
- Users can manually create entities (current missing feature)

**Cons:**
- Medium-high effort (3-5 days)
- Risk of regressions in rule matching (tight coupling)
- Requires careful migration of existing entity-roles.json consumers
- Parallel engine work means temporary inconsistency during migration

**Effort:** High (3-5 days split into 2-3 work units)

---

### Option C: Middle Ground

**What:** Fix the OTRO bug + add manual entity creation, but leave the dual-engine architecture in place.

**Changes:**
1. Fix `entity-roles.json` to include all 11 roles (fixes the OTRO bug)
2. Refactor role list into a shared constant (`src/lib/constants/entity-roles.ts`)
3. Add "Add Entity" button and form to `EntityManagementPage.tsx`
4. Add POST `/api/entity-context` endpoint for manual creation
5. Add validation enum to the entity-context Zod schema
6. Add unit tests for `entity-classifier.ts` (the untested core service)

**Pros:**
- Fixes the reported bug
- Enables manual entity entry (new capability)
- Single role source of truth
- Moderate effort
- No architecture change risk

**Cons:**
- Two parallel detection engines remain (inconsistent candidate lists)
- Silent candidate filtering unchanged
- Entity onboarding still only shows auto-detected entities
- Rule matching coupling remains

**Effort:** Medium (1-2 days split into 2 work units)

---

## Recommendation

**Option C — Middle Ground** is the pragmatic choice, with a follow-on to Option B for detection engine consolidation.

### Why not Option A alone?
The user explicitly asked for "improving the entity classification process similar to how we consolidated the bank rules engine." A single-file fix for OTRO doesn't meet that intent. The manual entity creation gap is also a real workflow blocker that should be addressed.

### Why not Option B immediately?
The bank rules consolidation had similar coupling risks and took 13 tasks across multiple PRs. Entity classification is tightly coupled with bank rules, import, and reconciliation. A full overhaul risks destabilizing the same production paths that the bank rules project just stabilized. A phased approach is safer.

### Proposed Phase 1 (this change — Option C)
1. Fix `entity-roles.json` → add all 11 roles (instant OTRO fix)
2. Extract role list to `src/lib/constants/entity-roles.ts` (single source of truth)
3. Add validation enum to `entity-context` Zod schema
4. Add "Add Entity" UI + API endpoint to EntityManagementPage
5. Add unit tests for `entity-classifier.ts`
6. Add i18n keys for manual entity creation

### Proposed Phase 2 (future change — completes Option B)
1. Consolidate `entity-detector.ts` + `ai-rules/scan` into a unified engine
2. Review and fix silent candidate filtering
3. Add integration tests for the unified detection flow

### Key Design Decisions for Phase 1
- **Role source**: Create `src/lib/constants/entity-roles.ts` with ALL 11 roles. Both EntityOnboardingModal and EntityManagementPage import from here.
- **Manual entity flow**: New POST endpoint `/api/entity-context/create` that accepts `{ pattern, role, glAccountCode }` — bypasses detection entirely.
- **Validation**: Entity context schema gets a `.refine()` or `.enum()` against the role list.
- **i18n**: No new keys needed for OTRO fix (already exists), but manual entity creation needs `entityManagement.create.*` keys.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Changes to entity roles could break rule matching | High | Keep role values identical; only change SOURCE, not VALUES |
| Adding manual entity creation could allow duplicate patterns | Medium | Rely on Prisma's `@@unique([companyId, pattern])` constraint |
| Role enum validation could reject existing DB records that have non-standard roles | Low | Make validation a warning, not a block, for existing records |
| EntityManagementPage currently has NO create action — UX needs design | Medium | Keep it simple: a "New Entity" button opens a dialog with pattern + role + GL account |
| Parallel detection engines will still produce different results after Phase 1 | Low (cosmetic) | Document this as a known limitation for Phase 2 |

---

## Ready for Proposal

**Yes** — but the orchestrator should tell the user:

> "The 'other' option bug is in `rules/entity-roles.json` — it's missing the OTRO role, so the dropdown never shows it (the handling code already exists). I recommend a phased approach:
> 1. **Phase 1** (~1-2 days): Fix the bug, add manual entity creation, consolidate role sources, add tests
> 2. **Phase 2** (future): Consolidate the two parallel detection engines into one
>
> This mirrors the bank rules approach — fix first, then consolidate — without the risk of a full overhaul destabilizing what was just stabilized."
