## Exploration: intent-first-entity-onboarding

### Current State
- `EntityOnboardingModal` fetches candidates from `GET /api/learning/smart-classify`, keeps per-entity `selections` keyed by role, renders a primary role dropdown, shows Actor Type from the selected role, and renders an optional TransactionIntent dropdown. Saving posts to `POST /api/learning/classify-entity` with `role`, optional `intent`, split direction, and OTRO `userDescription` when role is `OTRO`.
- The UI already has a direction-label bug: `directionProfile` values are ratios (`0..1`) from `entity-detector.ts`, but the modal compares them to `70`, so a 12 income / 0 expense entity (`creditPct: 1`) renders as Mixed instead of Income.
- `POST /api/learning/classify-entity` validates intent, validates role, saves an `EntityContext`, then `autoCreateRule()` creates/reactivates a linked `BankRule` with the selected intent. OTRO descriptions are persisted on `EntityContext.userDescription`; `BankRule` has `intent` but no `userDescription`, `notes`, or `requiresReview` field.
- `BankRule` CRUD accepts and returns `intent`, but create currently blocks when no GL account can be resolved and can also block on direction-profile validation. There is no BankRule-level audit field for the user's OTHER free text.
- `EntityContext` supports `userDescription`; `BankProfile` has `requiresReview`, but `BankRule` and `EntityContext` do not. `AuditLog.details` can preserve contextual metadata, but current classify audit includes intent only, not `userDescription`.
- Role currently drives account/rule creation only indirectly: the modal sends `role`, optional `glAccountCode`, and `classify-entity` falls back to AI parsing only when role is absent. If no GL account code is supplied, `autoCreateRule()` returns a warning and does not create a BankRule.

### Affected Areas
- `src/components/learning/EntityOnboardingModal.tsx` — main onboarding UI; role-first state model, Actor Type display, intent dropdown, OTHER textarea, save/pre-classify flow, and the `0..1` vs `70` direction label bug.
- `src/app/api/learning/classify-entity/route.ts` — validates role/intent, accepts `userDescription`, calls `classifyEntity`, and writes audit logs.
- `src/lib/services/entity-classifier.ts` — `classifyEntity()`, `computeDirectionProfile()`, and `autoCreateRule()` decide whether a linked BankRule is created and whether intent is stored.
- `src/lib/services/entity-context-service.ts` — persists internal role and `userDescription` on EntityContext.
- `prisma/schema.prisma` — `BankRule` has `intent` only; `EntityContext` has `userDescription`; neither has `requiresReview`; adding BankRule audit text/review status would need schema + migration.
- `src/app/api/bank-rules/route.ts` and `src/app/api/bank-rules/[id]/route.ts` — BankRule CRUD supports intent but not notes/user description/requires-review metadata.
- `src/lib/services/entity-detector.ts` and `src/lib/services/direction-filter.ts` — source of direction ratios and canonical direction helpers.
- `tests/components/EntityOnboardingModal.test.tsx` and `tests/components/batch-otro-classification.test.tsx` — existing component coverage for direction labels, OTRO, batch, and intent propagation.
- `tests/api/learning/classify-entity.test.ts`, `tests/api/learning/smart-classify.test.ts`, `tests/api/learning/pending-entities.test.ts`, `tests/api/bank-rules/*` — API coverage to extend for OTHER description, review/fallback, direction stats, and BankRule audit fields.

### Approaches
1. **Intent-first UI with internal role derivation and EntityContext audit only** — Make intent the primary user decision, keep role hidden/internal, derive a compatibility role server-side when needed, persist OTHER text on EntityContext and audit logs.
   - Pros: Smallest schema change footprint; aligns with current `EntityContext.userDescription`; avoids blocking on uncertain AI/account inference.
   - Cons: Does not satisfy the requirement that OTHER text be visible/auditable from BankRule or linked rule context unless consumers explicitly join/read EntityContext and AuditLog.
   - Effort: Medium

2. **Intent-first UI plus BankRule audit/review metadata** — Add BankRule-level `userDescription`/`notes` and `requiresReview` (or equivalent), pass OTHER description and uncertainty status through classify/auto-create/rule CRUD, while also keeping EntityContext.role internal.
   - Pros: Directly satisfies auditability on BankRule; supports review queues; makes uncertain account inference non-blocking via `requiresReview` instead of failed saves.
   - Cons: Requires Prisma migration, CRUD updates, and more tests; must choose fallback behavior when no GL account exists.
   - Effort: Medium-High

3. **Full account fallback with Unclassified account** — Introduce or detect a dedicated Unclassified GL account and always create a BankRule when account inference fails, marking it for review.
   - Pros: Strongest non-blocking save guarantee; rule context remains visible for reviewers.
   - Cons: Requires account provisioning/business rules; riskier accounting semantics if an unclassified account is applied automatically to transactions.
   - Effort: High

### Recommendation
Use Approach 2 as the proposal scope, with a narrow fallback policy: hide the role dropdown from the main flow; show intent as the primary control; show the OTHER free-text field when `intent === 'OTHER'`; preserve role internally using existing compatibility values (`OTRO` for OTHER or a deterministic fallback from intent/direction); fix direction labels to use real ratio stats; persist OTHER text on `EntityContext.userDescription`, include it in classify audit details, and add BankRule-level audit/review metadata only if linked rule creation succeeds. If GL/account inference is unavailable, save the EntityContext and return a non-blocking warning/requires-review signal instead of failing the entity save.

Recommended proposal boundaries:
- UI: intent-first EntityOnboardingModal; role hidden by default; Actor Type only as subtle assistance if kept; direction label uses `creditPct >= 0.8` / `debitPct >= 0.8` or shared `classifyDirection()`, never `> 70`.
- API/service: classify-entity accepts primary `intent`, `userDescription` for OTHER, optional/internal `role`; never rejects solely due to missing account inference; returns warnings/review metadata.
- Data: add BankRule audit/review fields only if product wants review status on rules (`userDescription` or `notes`, `requiresReview`); otherwise explicitly specify linked context/audit-log visibility as the audit source.
- Tests: start with failing tests for 12 credit / 0 debit label, OTHER intent textarea + saved payload, hidden role dropdown, classify-entity OTHER audit persistence, and non-blocking no-account classification.

### Risks
- Current main spec says OTRO without canonical role is blocked/never persists OTRO; the new product decision conflicts with that and should be explicitly MODIFIED in the delta spec.
- Adding `requiresReview` to BankRule is a schema migration; using only EntityContext/AuditLog avoids migration but may be weaker for BankRule-screen auditability.
- Auto-created BankRules currently require `context.glAccountId`; without a fallback account, some entity saves will not create linked rules. The proposal must define whether “visible/auditable in linked rule context” means BankRule when available, or EntityContext/AuditLog when no rule exists.
- Direction labels and split logic use different thresholds (`>70` bug, `>=0.15` mixed, `>=0.8` pure). The proposal should standardize user-facing labels separately from split eligibility.
- Hiding role can break tests and flows that assume `selectionsRef` only gets populated by role selection; intent changes must also track entities for saving.

### Ready for Proposal
Yes. The next phase should write a proposal for an intent-first onboarding slice that fixes the direction label bug, makes OTHER description mandatory only for `intent === 'OTHER'`, hides role from the main decision path, persists audit context, and guarantees entity save is non-blocking when AI/account inference is uncertain.
