# Design: Intent-First Entity Onboarding

## Technical Approach

Keep the existing `smart-classify -> EntityOnboardingModal -> classify-entity -> classifyEntity/saveContext -> autoCreateRule` path, but make intent the user-facing decision and role an internal compatibility value. The first slice persists `EntityContext` even when no GL account is available, and only creates/reactivates a `BankRule` when a valid account exists.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Direction labels | Reuse `classifyDirection()` and `DIRECTION_THRESHOLD` from `src/lib/services/direction-filter.ts`; map `credit/debit/ambas` to UI labels. | Keep modal-local `> 70` checks or add another threshold. | Existing detector emits ratios `0..1`; a shared threshold prevents future scale drift. |
| Role derivation | Add a small server-side helper near `classify-entity`/`entity-classifier`, e.g. `deriveRoleFromIntent(intent, directionProfile?)`, returning current `EntityRole` values (`OTHER -> OTRO`, customer/rent/owner income intents -> credit roles, expense/tax/loan -> debit roles, fallback `OTRO`). | Keep hidden client defaults; remove role from API. | Keeps current API/model compatible while making role internal and testable. |
| OTHER text | Treat `intent === 'OTHER'` as the validation trigger; store trimmed text in existing `EntityContext.userDescription`. | Require text only for `role === 'OTRO'`; add BankRule column. | Matches the new product language and avoids schema migration. |
| BankRule audit visibility | Include `entityContext` in BankRule GET/list responses so admin/UI can read `entityContext.userDescription`. | Duplicate text on `BankRule`; use only AuditLog. | Relation already exists (`BankRule.entityContextId`); no DB change, no duplicated source of truth. |
| Missing GL account | Save context and return a warning/review status; do not create a rule. | Create placeholder rule; use fallback account. | Avoids invalid auto-rules and unsafe accounting side effects. |

## Data Flow

```text
smart-classify (ratio stats)
  -> EntityOnboardingModal (intent + optional OTHER text + optional GL account)
  -> POST /api/learning/classify-entity
  -> derive internal role, validate intent/OTHER text
  -> saveContext(EntityContext.intent-adjacent metadata via userDescription + role)
  -> autoCreateRule only when context.glAccountId exists
  -> response: success + warning/requiresReview when no rule was created
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/components/learning/EntityOnboardingModal.tsx` | Modify | Drive save eligibility from intent, hide role dropdown/main actor path, render OTHER textarea when intent is `OTHER`, use shared direction label helper, send `intent`, `userDescription`, and optional `glAccountCode`. |
| `src/app/api/learning/classify-entity/route.ts` | Modify | Accept intent-first payload; derive/validate role internally; validate OTHER text by intent; include `userDescription` in audit details and return rule-creation warning metadata. |
| `src/lib/services/entity-classifier.ts` | Modify | Make role derivation/service input tolerant of internal role; keep `saveContext` before `autoCreateRule`; preserve no-account warning. |
| `src/lib/services/entity-context-service.ts` | Modify | Persist derived role and `userDescription`; include `userDescription` in context audit details. |
| `src/app/api/bank-rules/route.ts` | Modify | Include `entityContext: { select: { id, userDescription, role, pattern } }` in GET/list responses. |
| `src/app/api/bank-rules/[id]/route.ts` | Modify | Include the same `entityContext` projection in detail/update responses where useful. |
| `tests/components/EntityOnboardingModal.test.tsx` | Modify | Cover hidden role path, intent-first save, OTHER validation, and 100% credit label. |
| `tests/api/learning/classify-entity.test.ts` / `tests/api/bank-rules/*` | Modify | Cover OTHER persistence, no-account no-rule behavior, audit payload, and BankRule context exposure. |

## Interfaces / Contracts

`POST /api/learning/classify-entity` should accept:

```ts
{ pattern: string; intent: TransactionIntent; userDescription?: string; glAccountCode?: string; transactionDirection?: 'debit' | 'credit' | 'both' }
```

`role` remains accepted for backward compatibility but is optional for onboarding. Response stays successful when context saves, with optional `{ warning, requiresReview: true, ruleCreated: false }` when no GL account exists.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `classifyDirection()` label mapping and intent-to-role derivation | Focused Vitest table tests. |
| Component | Intent-first modal behavior, OTHER textarea validation/payload, no role dropdown in main path | Existing Testing Library tests. |
| API/service | `classify-entity` saves `EntityContext.userDescription`, does not fail without GL account, does not create invalid rule | Existing API/service test patterns with Prisma mocks/test DB. |
| API | BankRule list/detail exposes `entityContext.userDescription` | Extend bank-rules route tests. |

## Migration / Rollout

No migration required. This deliberately uses existing `EntityContext.userDescription`, `BankRule.intent`, and the existing `BankRule -> EntityContext` relation. Roll out as one safe slice; if diff exceeds the 400-line review budget, split UI first from API/service/admin exposure.

## Open Questions

- [ ] None blocking for the first slice.
