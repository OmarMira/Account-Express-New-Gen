# Proposal: Fase 2 — Wizard de Reglas Bancarias (3 pasos)

## Intent

BankRulesPage has 3 disconnected flows (chat classify, IA rule generator, Apply All) with no guided UX. Users must jump between them to classify entities, then generate rules, then apply — and nothing communicates progress. This change builds a unified 3-step wizard that replaces ad-hoc navigation with a linear flow: classify → review → apply.

## Scope

### In Scope
- 3-step modal/drawer: Paso 1 (classify entities), Paso 2 (review proposed rules), Paso 3 (apply summary + execute)
- AI-suggested role defaults per entity, user-confirmable
- Role → GL account mapping for proposed rules (derived from existing `ROLE_ACCOUNT_MAP`)
- Empty state when no pending entities exist
- Non-blocking: user can advance without classifying all entities
- Historical sweep: Paso 3 applies rules to past uncategorized transactions + activates for future
- Explicit conflict prevention: wizard ONLY shows entities with NO active rule (delta-only)

### Out of Scope
- Re-classification path (use existing BankRulesPage table editor)
- Replacing the existing BankRulesPage table editor
- Mandatory classification enforcement
- Changing how generated rules work once created (editable from BankRulesPage as any rule)

## Capabilities

### New Capabilities
- `entity-classification-wizard`: 3-step guided flow for bulk entity classification and rule generation. Consumes `clusterByBehavior()` output, existing entity APIs, and bank rules APIs.

### Modified Capabilities
- None. The wizard is additive — it orchestrates existing capabilities (entity-classification, rule-matching-engine, entity-role-suggestion) without changing their spec-level behavior.

## Approach

Wizard is a client-side Zustand store + shadcn/ui dialog component that calls existing APIs. Paso 1 fetches `EntityCandidate[]` from `clusterByBehavior()`, displays with AI-suggested roles (via `POST /api/learning/suggest-role` for OTRO or existing role heuristics). Paso 2 maps role → GL account via `ROLE_ACCOUNT_MAP`, user adjusts. Paso 3 POSTs to `/api/bank-rules` (create rules) then `/api/bank-rules/apply-all` (historical sweep). All rules land in BankRulesPage as regular rules.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/bank-rules/page.tsx` | Modified | Add "Configuración Inteligente" button + wizard trigger |
| `src/components/wizard/` | New | Wizard components (3 pasos, store, types) |
| `src/lib/stores/wizard-store.ts` | New | Zustand store for wizard state machine |
| `src/lib/services/wizard-service.ts` | New | Orchestration: fetch candidates, create rules, apply |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Large historical apply blocks UI | Medium | `/api/bank-rules/apply-all` already async; show progress indicator |
| Role suggestion latency per entity | Low | Batch suggestion or use heuristic fallback; toast on timeout |
| User closes wizard mid-flow | Low | Non-blocking by design; no data loss (nothing persisted until Paso 3) |

## Rollback Plan

Wizard is additive. No schema changes. Rollback = revert wizard files + button in BankRulesPage. Existing rules and entities untouched — wizard only creates what already existed through other paths.

## Dependencies

- `clusterByBehavior()` already merged in `entity-detector.ts`
- Existing APIs: `POST /api/bank-rules`, `POST /api/bank-rules/apply-all`, entity APIs
- `ROLE_ACCOUNT_MAP` already exists for role → GL mapping

## Success Criteria

- [ ] Wizard opens from BankRulesPage and shows empty state when no entities pending
- [ ] Paso 1 shows entities with AI-suggested roles, user can override
- [ ] Paso 2 shows proposed rules with GL accounts from role mapping
- [ ] Paso 3 executes and shows affected transaction count
- [ ] Generated rules appear in BankRulesPage as regular editable rules
- [ ] `npx tsc --noEmit` passes with 0 errors; `bunx vitest run` passes
