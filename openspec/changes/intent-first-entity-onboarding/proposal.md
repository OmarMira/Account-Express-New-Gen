# Proposal: Intent-First Entity Onboarding

## Intent

Make onboarding ask the user for transaction intent first, not actor role. Role remains internal compatibility data derived from intent/history/description. The flow must save entity intent even when AI confidence is low, while avoiding invalid auto-rules without a GL account.

## Problem

The current modal is role-first, exposes implementation vocabulary, mislabels real direction ratios by comparing `0..1` values to `70`, and ties rule creation too tightly to account inference.

## Goals

- Primary user decision is `TransactionIntent`; role is hidden from the main flow.
- `OTHER` intent opens free-text explanation stored in `EntityContext.userDescription`.
- Direction labels use DB stats and normalized thresholds (`0..1`), e.g. 12 credit / 0 debit => Income.
- Entity + intent save is never blocked only by low AI confidence.
- No empty/broken `BankRule` is created without a GL account.

## Non-goals

- Removing `role` from the data model/API.
- Adding redundant `BankRule` description columns.
- Changing rule-matching semantics beyond safe auto-create gating.

## User Flows

- User reviews candidate, selects intent, optionally chooses/confirms GL account, saves.
- If intent is `OTHER`, user enters an explanation; it persists on linked `EntityContext` and can surface via `BankRule.entityContext`.
- If GL account is unresolved, first slice asks the user to choose one before saving the rule; entity context may still save without an auto-rule.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `entity-classification`: hide role in onboarding, derive internal role, persist context before safe rule creation.
- `transaction-intent`: make intent the primary onboarding input; require explanation only for `OTHER`.
- `direction`: render labels from normalized stats/shared thresholds.
- `entity-role-suggestion`: supersede OTRO-role blocking in this modal with intent-first OTHER description behavior.

## Data / Persistence Approach

- Store intent on `EntityContext`/linked `BankRule` as today when a rule is valid.
- Store OTHER explanation in existing `EntityContext.userDescription`; expose through `BankRule.entityContext` include/relation.
- Keep `role` internally derived for compatibility; future SDD may remove it.
- Prefer first slice: require explicit GL account selection before auto-rule creation when confidence/account inference is insufficient. A review/suspense fallback account is out of scope unless existing support is proven.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/components/learning/EntityOnboardingModal.tsx` | Modified | Intent-first UX, OTHER text, GL choice, direction label fix |
| `src/app/api/learning/classify-entity/route.ts` | Modified | Accept intent/description, low-confidence non-blocking save |
| `src/lib/services/entity-classifier.ts` | Modified | Internal role derivation, safe auto-rule gating |
| `src/lib/services/entity-context-service.ts` | Modified | Persist `userDescription` and derived role |

## Acceptance Criteria

- [ ] Role dropdown is not part of the main onboarding decision path.
- [ ] `OTHER` saves explanation to `EntityContext.userDescription` without `BankRule` schema additions.
- [ ] 100% credit history renders Income using normalized thresholds.
- [ ] Low AI confidence alone does not block entity+intent save.
- [ ] No auto-rule is created unless a valid GL account is present.

## Risks and Rollout

| Risk | Likelihood | Mitigation |
|---|---|---|
| Existing OTRO-role spec conflicts | High | Modify spec explicitly |
| Hidden role breaks selection state | Medium | Drive save state from intent selection |
| No GL account reduces auto-rule creation | Medium | Safer first slice: prompt account before rule save |

## Rollback Plan

Revert modal/API/service changes. Existing persisted `EntityContext.userDescription`, intent, and role data remain compatible because no new columns are required.

## Open Questions

None for first slice.
