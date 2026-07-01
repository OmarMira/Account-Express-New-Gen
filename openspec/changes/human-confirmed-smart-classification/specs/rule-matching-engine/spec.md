# Delta for Rule Matching Engine

## ADDED Requirements

### Requirement: Automation Remains Confirmation-Gated

The rule matching engine behavior SHALL remain unchanged for existing active rules, but smart-classification suggestions MUST NOT create, activate, or mutate BankRules until a human confirms the classification.

#### Scenario: Existing matching unchanged

- GIVEN an active BankRule already exists
- WHEN a transaction matches it
- THEN the rule matching engine evaluates it using existing semantics
- AND smart-classification confidence does not affect matching

#### Scenario: Suggestion does not create rule

- GIVEN smart classification suggests a role and intent
- WHEN no user confirmation has occurred
- THEN no BankRule is created, activated, or modified
- AND unmatched transactions remain unmatched by rules

#### Scenario: Legacy OTRO linked rule is preserved for review

- GIVEN a migrated legacy OTRO context has an existing linked BankRule
- WHEN enriched reclassification creates a pending suggestion
- THEN the rule is not silently deleted, activated, deactivated, or overwritten
- AND the review payload identifies the linked rule for operator decision

#### Scenario: Confirmation permits rule creation

- GIVEN the user confirms role, intent, and account selection
- WHEN the confirmation is saved
- THEN downstream rule creation MAY occur through the existing rule creation path
- AND the resulting rule remains subject to normal matching semantics
