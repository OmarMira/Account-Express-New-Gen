# Archive Report: Smart Entity Classification

**Change**: smart-entity-classification
**Archived**: 2026-06-17
**Archive Location**: `openspec/changes/archive/2026-06-17-smart-entity-classification/`
**Status**: ✅ Complete — all 22 tasks done, 0 CRITICAL issues

---

## 1. Executive Summary

Four tightly coupled entity data quality issues were addressed in a single change:

| Feature | Description | Status |
|---------|-------------|--------|
| **F1 — Role Validation** | Changed `z.string()` to `entityRoleSchema` (z.enum) on all 4 creation/update paths | ✅ |
| **F2 — Direction Mismatch Warning** | Added `expectedDirection` to ROLE_ACCOUNT_MAP; `checkRoleDirectionMismatch()` pure function + yellow banner UI | ✅ |
| **F3 — Split Mixed Entities** | Frontend detection of mixed-direction candidates (both sides >= 15%) → split into direction-specific EntityContext records | ✅ |
| **F4 — AI Role Suggestion** | New `POST /api/learning/suggest-role` endpoint; 1s debounced toast on OTRO free-text; canonical role assignment | ✅ |

### Components Modified/Created

| Layer | Files |
|-------|-------|
| **Schema & Types** | `prisma/schema.prisma`, `src/lib/types/entity-context.ts`, `src/lib/constants/entity-roles.ts`, `src/lib/constants/role-account-map.ts`, `src/lib/validations/entity-context.ts` |
| **Services** | `src/lib/services/entity-enricher.ts`, `src/lib/services/entity-context-crud-service.ts` |
| **Routes** | `src/app/api/entity-context/[id]/route.ts`, `src/app/api/learning/classify-entity/route.ts`, `src/app/api/learning/suggest-role/route.ts` (new) |
| **Frontend** | `src/components/learning/EntityOnboardingModal.tsx` (F2 warning, F3 split, F4 toast, OTRO save block) |
| **Migration** | `prisma/scripts/migrate-roles-to-otro.ts` |

---

## 2. Artifact List

| Artifact | Path | Status |
|----------|------|--------|
| Proposal | `proposal.md` | ✅ |
| Exploration | `exploration.md` | ✅ |
| Spec — Entity Classification (delta) | `specs/entity-classification.delta.md` | ✅ (merged) |
| Spec — Entity Enrichment (delta) | `specs/entity-enrichment.delta.md` | ✅ (merged) |
| Spec — Direction Mismatch | `specs/entity-direction-mismatch.md` | ✅ (copied) |
| Spec — AI Role Suggestion | `specs/entity-role-suggestion.md` | ✅ (copied) |
| Spec — Entity Split | `specs/entity-split.md` | ✅ (copied) |
| Design | `design.md` | ✅ |
| Tasks | `tasks.md` | ✅ (22/22) |
| Verify Report | `verify-report.md` | ✅ (PASS WITH WARNINGS) |
| Archive Report | `archive-report.md` | ✅ (this file) |

---

## 3. Specs Synced to Main

| Domain | Action | Details |
|--------|--------|---------|
| `entity-classification` | **Updated** | Role Validation extended to all 4 paths (PATCH, classify-entity); OTRO AI Suggestion added; Direction Mismatch Warning added; Split Mixed Entities added |
| `entity-enrichment` | **Updated** | Direction Profile now includes `expectedDirection` per role table; new `checkRoleDirectionMismatch()` requirement |
| `entity-direction-mismatch` | **Created** | Full spec: warning on role assignment, SOCIO bypass, override logging |
| `entity-role-suggestion` | **Created** | Full spec: AI endpoint contract, debounced toast UI scenarios |
| `entity-split` | **Created** | Full spec: mixed detection threshold, split flow, re-scan detection |

---

## 4. Task Completion Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1 — Foundation (schema, types, role validation) | 5 | ✅ All [x] |
| Phase 2 — Core Services (enricher, suggest-role, CRUD) | 3 | ✅ All [x] |
| Phase 3 — Routes (PATCH validation, classify-entity, context) | 3 | ✅ All [x] |
| Phase 4 — Frontend (warning, split, OTRO toast, block save) | 4 | ✅ All [x] |
| Phase 5 — Testing (unit + integration + component) | 6 | ✅ All [x] |
| Phase 6 — Migration (one-time script) | 1 | ✅ All [x] |
| **Total** | **22** | **✅ 22/22** |

---

## 5. Build & Test Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | **0** (`npx tsc --noEmit`) |
| Tests passed | **428** (59 files) |
| Tests failed | **0** |
| Tests skipped | **1** |

---

## 6. Known Debt

The following items were identified during verification and remain as technical debt:

### WARNING (non-blocking)
1. **Duplicate `checkRoleDirectionMismatch()`** — `EntityOnboardingModal.tsx` has its own copy of the pure function (lines 54–74). The server-computed `directionWarning` from the enricher pipeline is not consumed by the frontend. Should remove the dupe and pass server-computed value.

### SUGGESTIONS
1. **SOCIO special-casing in entity-first-flow.ts** — SOCIO direction handling still has special-case logic that could be unified with the `expectedDirection: 'mixed'` approach.
2. **Otoniela/Ortiz role corrections pending** — Entity corrections for Otoniela (→ PROVEEDOR) and SOCIO direction mismatch handling need to be addressed in a follow-up change.
3. **Re-scan detection prompt** — Split creates EntityContext for one direction; the re-scan prompt for the opposite direction is implied/deferred rather than explicit.
4. **F4 debounce** uses `useEffect` with `Object.entries(descriptions)` as implicit dependency — `eslint-disable` comment for `exhaustive-deps`.
5. **Migration script** doesn't store original role in metadata (spec marked this optional).

---

## 7. Next Steps

1. Address entity corrections (Otoniela → PROVEEDOR, SOCIO direction mismatch)
2. Remove SOCIO special-casing from `entity-first-flow.ts` using `expectedDirection: 'mixed'`
3. Consolidate the duplicate `checkRoleDirectionMismatch()` (frontend copy → server response)
4. Consider enabling coverage reporting

---

## 8. Design vs Implementation Agreement

| Decision | Followed? | Notes |
|----------|-----------|-------|
| F1: Shared entityRoleSchema | ✅ Yes | Exported from entity-roles.ts |
| F1: Per-route Zod parse (not middleware) | ✅ Yes | explicit safeParse in routes |
| F2: Pure function + UI banner | ✅ Yes | Both frontend and backend implementations |
| F3: Suffix pattern (not compound unique) | ✅ Yes | `" - ingresos"` / `" - retiros"` |
| F3: transactionDirection on EntityContext | ✅ Yes | Schema, types, CRUD, validation |
| F4: Standalone suggest-role route | ✅ Yes | Separate file |
| F4: Custom useEffect debounce (no lodash) | ✅ Yes | `debounceTimers` ref |
| F4: Hardcoded minimal AI prompt | ✅ Yes | Built inline |
| F4: 0.7 confidence threshold | ✅ Yes | Used in toast and auto-assign |
| Migration: coalesce + one-time DB | ✅ Partial | Original role not stored in metadata |

---

## 9. SDD Cycle Complete

The change has been fully planned (proposal → 5 specs → design → tasks), implemented (22 tasks), verified (0 tsc errors, 428 tests passed), and archived.

**Engram observation IDs for traceability:**
- proposal, specs, design, tasks, verify-report — all persisted under topic_key `sdd/smart-entity-classification/*` in engram
- archive-report — topic_key `sdd/smart-entity-classification/archive-report`
