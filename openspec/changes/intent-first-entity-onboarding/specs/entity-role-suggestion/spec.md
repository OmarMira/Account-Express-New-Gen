# Delta for Entity Role Suggestion

## MODIFIED Requirements

### Requirement: Debounced Toast UI

In the intent-first EntityOnboardingModal, selecting TransactionIntent `OTHER` MUST show a free-text description for business context, not a role-first OTRO correction flow. AI role suggestion MAY still exist outside this modal or as secondary assistance, but it MUST NOT block saving `OTHER` intent context. Any derived role remains internal compatibility data.
(Previously: OTRO role selection triggered AI role suggestion and instructed the user to choose a canonical role.)

#### Scenario: OTHER intent does not require canonical role assignment

- GIVEN the user selects TransactionIntent `OTHER`
- WHEN they enter a valid description
- THEN the entity can be saved with internal derived role data
- AND the user is not forced through an `[ASIGNAR]` canonical role action

#### Scenario: AI suggestion is secondary if present

- GIVEN role suggestion assistance is still displayed
- WHEN confidence is high, low, or unavailable
- THEN the suggestion MAY help derive internal compatibility role
- AND it MUST NOT prevent saving valid `OTHER` intent with description

#### Scenario: Existing role suggestion outside modal remains compatible

- GIVEN another workflow explicitly uses role-first OTRO suggestion
- WHEN that workflow calls `/api/learning/suggest-role`
- THEN existing endpoint validation and response shape remain valid
- AND this change only supersedes blocking behavior in intent-first onboarding

## ADDED Requirements

### Requirement: Regression coverage for intent-first OTHER

The test suite MUST cover that intent-first OTHER persists description without requiring visible role selection or BankRule schema additions.

#### Scenario: UI regression for OTHER

- GIVEN EntityOnboardingModal renders a candidate
- WHEN the user selects `OTHER` intent and types a description
- THEN the save payload includes intent and userDescription
- AND no role dropdown interaction is required
