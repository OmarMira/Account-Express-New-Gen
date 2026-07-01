# Human-Confirmed Smart Classification Specification

## Purpose

Suggest entity role and transaction intent from aggregated entity history, require human confirmation before automation, and learn from confirmed corrections using plain-language UX.

## Requirements

### Requirement: Entity History Aggregation

The system MUST group transactions by detected entity before classification and SHALL compute count, total amount, active months, dominant direction, direction percentages, representative and recent descriptions, amount range/average, average interval, and recurrence label.

#### Scenario: Aggregated summary is produced before classification

- GIVEN multiple transactions detected for the same entity
- WHEN smart classification starts
- THEN one history summary is built for that entity
- AND the summary includes direction, recurrence, amount, description, and timing metrics

#### Scenario: Single transaction still has a summary

- GIVEN a first-time detected entity
- WHEN smart classification starts
- THEN the system creates a cold-start summary with count 1
- AND marks recurrence as one-time or insufficient-history

### Requirement: Context-Enriched Suggestions

Classifiers, heuristics, and LLM prompts MUST receive the aggregated entity summary, not only one transaction description. Prompt examples SHALL be illustrative only; generated prompts MUST use tenant/company data generically and MUST NOT hardcode example names or amounts.

#### Scenario: LLM receives entity history context

- GIVEN an entity with recurring history
- WHEN an LLM classification is requested
- THEN the prompt includes aggregated history, direction, recurrence, and recent descriptions
- AND no hardcoded sample entity data is injected

### Requirement: Confidence Signals

Direction and recurrence MUST be first-class confidence signals. Recurring inflows SHOULD raise tenant/customer confidence, recurring outflows SHOULD raise vendor/expense confidence, and mixed direction MUST bias toward review.

#### Scenario: Mixed direction requires review

- GIVEN an entity with meaningful credit and debit percentages
- WHEN confidence is computed
- THEN the suggestion is capped below high confidence
- AND the entity is marked for human review

### Requirement: Cold Start and Re-Evaluation

Entities below configurable high-confidence thresholds MUST produce provisional suggestions or pending review. The system SHALL re-evaluate entities when history accumulates, but MUST NOT overwrite user-confirmed classifications automatically.

#### Scenario: Insufficient history stays provisional

- GIVEN an entity below the configured minimum occurrences or active months
- WHEN classification runs
- THEN no final automation is produced
- AND the UI asks one plain-language review question or shows a provisional suggestion

#### Scenario: Later evidence suggests update only

- GIVEN a user-confirmed classification exists
- WHEN new history conflicts with it
- THEN the system MAY suggest an update
- AND MUST NOT replace the confirmed classification automatically

### Requirement: Confirmation and Learning Guardrails

No final rule, accounting behavior, or persisted final OTHER/OTRO classification SHALL be created before human confirmation. Confirmed corrections MUST improve future suggestions for similar entities or patterns.

#### Scenario: Confirmation gates automation

- GIVEN a smart suggestion is shown to the user
- WHEN the user has not confirmed it
- THEN no BankRule, accounting automation, or final classification is created

#### Scenario: Correction becomes learning signal

- GIVEN the user changes a suggested role or intent before confirming
- WHEN the confirmation is saved
- THEN future similar entities use that correction as a learning signal
- AND the explanation remains understandable without accounting jargon

### Requirement: Legacy OTRO Review Surfacing

Legacy `OTRO` entity contexts MUST be eligible for history-enriched reclassification suggestions after deploy. The system SHALL surface those suggestions as pending review on first login or first visit to the learning/classification flow.

#### Scenario: First visit shows migrated uncertainty

- GIVEN legacy OTRO contexts were migrated to pending review
- WHEN the operator first logs in or opens the learning flow after deploy
- THEN the system shows pending enriched suggestions for those entities
- AND labels them as requiring review, not confirmed classifications

#### Scenario: Existing transaction history drives reclassification

- GIVEN a migrated legacy context has matching transaction history
- WHEN the suggestion is prepared
- THEN aggregation uses existing company transaction history
- AND preserved userDescription is included when present

#### Scenario: Confirmed data remains authoritative

- GIVEN an entity already has user-confirmed classification data
- WHEN legacy OTRO review processing runs
- THEN confirmed role, intent, account, and rules are not overwritten
- AND any different recommendation is shown only as a pending suggestion
