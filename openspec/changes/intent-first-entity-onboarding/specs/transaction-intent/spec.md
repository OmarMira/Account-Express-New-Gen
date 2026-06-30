# Delta for Transaction Intent

## ADDED Requirements

### Requirement: Intent-first onboarding selection

EntityOnboardingModal MUST require the user decision to be expressed as `TransactionIntent` before saving classification intent. Role selection MUST NOT be the primary decision. Intent values MUST use the existing TransactionIntent enum and bilingual labels.

#### Scenario: Intent is the primary input

- GIVEN the onboarding modal is open
- WHEN a candidate is displayed
- THEN the user can select one TransactionIntent value as the primary classification choice
- AND the UI does not require choosing a role first

#### Scenario: Intent persists without auto-rule

- GIVEN the user selects an intent but no GL account is resolved
- WHEN the user saves
- THEN EntityContext persists the selected intent/context data
- AND BankRule creation waits until a valid GL account or supported review fallback exists

### Requirement: OTHER intent description

When intent is `OTHER`, the modal MUST show a free-text description field and require a meaningful description before saving. The description MUST persist to `EntityContext.userDescription` and MUST be available through linked `BankRule.entityContext` when a rule exists.

#### Scenario: OTHER opens free-text description

- GIVEN the user selects intent `OTHER`
- WHEN the selection changes
- THEN a free-text description field is displayed
- AND save is blocked until a non-empty meaningful description is provided

#### Scenario: OTHER description persists to EntityContext

- GIVEN the user selects `OTHER` and enters a description
- WHEN classification is saved
- THEN `EntityContext.userDescription` stores that description
- AND no new BankRule description column is written

#### Scenario: Non-OTHER does not require description

- GIVEN the user selects any intent except `OTHER`
- WHEN they save without a description
- THEN classification may proceed if other required fields are valid
- AND `userDescription` is omitted or preserved according to existing update semantics

### Requirement: Classify entity API accepts intent-first payload

POST `/api/learning/classify-entity` MUST accept intent as the user-facing classification choice, optional `userDescription` for `OTHER`, and optional/internal role compatibility data. The endpoint MUST validate intent against the shared enum.

#### Scenario: API validates intent

- GIVEN a classify request with an unsupported intent value
- WHEN the endpoint validates the payload
- THEN it returns HTTP 400
- AND no EntityContext or BankRule is created

#### Scenario: API saves valid OTHER description

- GIVEN a valid `OTHER` intent request with userDescription
- WHEN the endpoint saves classification
- THEN the response includes saved EntityContext data
- AND the description is available for audit through entity context
