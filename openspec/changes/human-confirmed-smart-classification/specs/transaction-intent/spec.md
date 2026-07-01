# Delta for Transaction Intent

## ADDED Requirements

### Requirement: Intent Suggested From Confirmed Plain-Language Context

Transaction intent SHOULD be suggested from aggregated entity history and plain-language confirmation, not from accounting jargon. Persisted intent MUST represent a user-confirmed answer or remain unset until confirmation.

#### Scenario: Intent suggestion uses history

- GIVEN an entity history summary with recurrence, direction, descriptions, and amount patterns
- WHEN smart classification produces a suggestion
- THEN it includes a likely TransactionIntent when evidence supports one
- AND explains the reason in non-accountant language

#### Scenario: Unconfirmed intent is not final

- GIVEN the system suggests an intent
- WHEN the user has not confirmed it
- THEN the intent is treated as provisional
- AND no BankRule or final classification persists it as confirmed

#### Scenario: User confirms or corrects intent

- GIVEN a suggested intent is displayed
- WHEN the user confirms it or selects a different intent
- THEN the confirmed intent is saved
- AND the confirmed answer can train future similar suggestions
