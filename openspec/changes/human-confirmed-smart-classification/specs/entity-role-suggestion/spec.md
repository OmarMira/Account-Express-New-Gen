# Delta for Entity Role Suggestion

## ADDED Requirements

### Requirement: Aggregated Role and Intent Suggestion

The suggestion endpoint MUST accept or derive an aggregated entity history summary and SHALL suggest role, likely transaction intent, confidence, and a plain-language explanation. Suggestions MUST avoid accounting jargon and MUST ask one simple question when evidence is insufficient.

#### Scenario: History-enriched suggestion returned

- GIVEN an entity summary with recurring direction, amounts, and recent descriptions
- WHEN a suggestion is requested
- THEN the response includes suggestedRole, suggestedIntent, confidence, and explanation
- AND the explanation references human-readable evidence such as recurrence or money direction

#### Scenario: Insufficient evidence asks a question

- GIVEN entity history below the configured high-confidence threshold
- WHEN a suggestion is requested
- THEN the response is provisional or pending review
- AND includes one simple question for the user

### Requirement: Generic Prompt Construction

LLM prompts MUST be generated from the current tenant/company and entity summary. Prompt examples in documentation or tests are illustrative only and MUST NOT be hardcoded into runtime prompts.

#### Scenario: Prompt uses runtime data only

- GIVEN a tenant with real company transactions
- WHEN the LLM prompt is built
- THEN it contains that tenant's aggregated entity context
- AND contains no fixed sample person, merchant, amount, or history from documentation

### Requirement: Correction Learning

Confirmed user corrections MUST become learning signals for future similar entities or patterns, without changing already confirmed entities automatically.

#### Scenario: Correction improves future suggestion

- GIVEN the user changes a suggested role before confirming
- WHEN a similar entity is classified later
- THEN the corrected answer influences the new suggestion
- AND the system still requires confirmation before automation
