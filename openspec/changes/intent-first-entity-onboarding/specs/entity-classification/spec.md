# Delta for Entity Classification

## MODIFIED Requirements

### Requirement: Actor Type and Transaction Intent in Entity Onboarding

EntityOnboardingModal MUST make TransactionIntent the primary user decision. Role MUST NOT be shown as the main editable onboarding control; it remains internal compatibility data derived from intent, history, account selection, or description. Actor Type, if shown, MUST be read-only assistance and MUST NOT be required before intent selection. Intent labels MUST remain bilingual.
(Previously: The modal showed role/Actor Type from user role selection and intent was optional.)

#### Scenario: Actor Type is secondary if shown

- GIVEN EntityOnboardingModal renders entity candidates
- WHEN the user reviews a candidate
- THEN Actor Type is absent or read-only contextual assistance
- AND it is visually distinct from editable controls

#### Scenario: Direction hint is context only

- GIVEN a candidate has real transaction direction stats
- WHEN the modal renders direction assistance
- THEN the hint follows real stats/shared direction helpers
- AND it does not require visible role selection

#### Scenario: Intent dropdown present and bilingual

- GIVEN the modal is open with at least one candidate
- WHEN the user reviews an entity card
- THEN the primary Select is labeled with the intent i18n key
- AND it contains one option per TransactionIntent value

#### Scenario: Intent selection drives save readiness

- GIVEN the user selects a TransactionIntent
- WHEN required intent-specific inputs are valid
- THEN the entity can be classified without role dropdown interaction
- AND the save payload includes the selected intent

#### Scenario: Internal role remains compatible

- GIVEN the user selects an intent and saves an entity
- WHEN the API receives the classification request
- THEN a valid internal role is derived or preserved for EntityContext compatibility
- AND invalid or empty roles are not persisted

#### Scenario: Low confidence does not block entity save

- GIVEN AI confidence is below the auto-rule confidence threshold
- WHEN the user explicitly confirms intent for the entity
- THEN EntityContext and intent MUST be saved
- AND low confidence alone MUST NOT return a blocking error

### Requirement: Auto-Create BankRule on Classification

After `classifyEntity()` saves EntityContext, the system MUST auto-create/reactivate a BankRule only when a valid GL account is available. The rule MUST include pattern, glAccountId, transactionDirection from normalized direction classification, priority=5, isActive=true, entityContextId, and intent. If no valid GL account is available, EntityContext MUST remain saved and rule creation MUST wait for GL selection or an explicit review fallback if one is already supported.
(Previously: Auto-create was expected after classification with a warning only for missing GL account.)

#### Scenario: Classification creates BankRule with inferred direction

- GIVEN classification returns pattern, valid glAccountId, and directionProfile
- WHEN auto-create runs after saving EntityContext
- THEN a BankRule is created with inferred transactionDirection and entityContextId
- AND priority=5, isActive=true, and intent are saved

#### Scenario: Direction inference — credit dominant

- GIVEN `creditPct >= 0.8` and `debitPct < 0.8`
- WHEN auto-create computes direction
- THEN `transactionDirection = "credit"`

#### Scenario: Direction inference — debit dominant

- GIVEN `debitPct >= 0.8` and `creditPct < 0.8`
- WHEN auto-create computes direction
- THEN `transactionDirection = "debit"`

#### Scenario: Direction inference — mixed

- GIVEN neither normalized ratio reaches `0.8`
- WHEN auto-create computes direction
- THEN `transactionDirection = "any"`

#### Scenario: No GL account means no invalid rule

- GIVEN the user saves entity intent without a valid GL account
- WHEN classification completes
- THEN EntityContext and intent are persisted
- AND no BankRule with empty, missing, or placeholder glAccountId is created
- AND the response exposes a non-blocking warning or review-needed signal

#### Scenario: Active rule with same entityContextId skips duplicate

- GIVEN an active BankRule already references the EntityContext
- WHEN classification runs again with the same context
- THEN no duplicate BankRule is created

#### Scenario: Inactive rule with same entityContextId updates

- GIVEN an inactive BankRule references the EntityContext
- WHEN classification returns a valid pattern and GL account
- THEN the existing rule is reactivated and updated

#### Scenario: Manual rule with same pattern is not deduped

- GIVEN a manual BankRule has the same pattern and null entityContextId
- WHEN a new context is classified
- THEN the manual rule is not modified
- AND a context-linked rule may be created when GL account is valid

#### Scenario: autoCreateRule includes intent value

- GIVEN autoCreateRule creates or updates a BankRule
- WHEN the caller provides intent
- THEN the rule stores that intent
- AND intent does not affect matching semantics

#### Scenario: Source guard blocks AI auto-rule

- GIVEN classification source is AI or undefined
- WHEN EntityContext is saved
- THEN no automatic BankRule is created
- AND user confirmation is required before rule creation

## ADDED Requirements

### Requirement: BankRule audit through linked EntityContext

BankRule views and APIs that surface classification context MUST expose the linked `entityContext`, including `userDescription` when present. The system MUST NOT add a new BankRule description column for this change.

#### Scenario: OTHER description auditable through rule context

- GIVEN a BankRule links to an EntityContext with `userDescription`
- WHEN the rule is fetched for review or audit
- THEN the response includes `entityContext.userDescription`
- AND no BankRule-specific description field is required
