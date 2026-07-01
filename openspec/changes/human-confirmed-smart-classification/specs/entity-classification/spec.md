# Delta for Entity Classification

## ADDED Requirements

### Requirement: History-Aware Classification Input

Entity classification MUST consume an aggregated entity history summary before suggesting role, intent, confidence, or review state. Single-transaction signals MAY be used only as provisional cold-start evidence.

#### Scenario: Classification uses history summary

- GIVEN transactions grouped for one detected entity
- WHEN classification runs
- THEN role and confidence are derived from the entity history summary
- AND not from an isolated transaction memo alone

#### Scenario: Cold-start classification is not final

- GIVEN only one transaction exists for an entity
- WHEN classification runs
- THEN the result is provisional or pending review
- AND high confidence is blocked until configured minimum history is met

### Requirement: User Confirmations Are Protected

User-confirmed classifications MUST NOT be overwritten by automatic reclassification. Later evidence MAY create a suggested update for review.

#### Scenario: Confirmed classification survives re-evaluation

- GIVEN an entity has a user-confirmed role and intent
- WHEN more history accumulates and re-evaluation runs
- THEN the confirmed values remain unchanged
- AND any conflicting evidence is presented as an update suggestion only

### Requirement: Legacy OTRO Reclassification Migration

Existing `EntityContext.role = 'OTRO'` records MUST be treated as legacy uncertainty unless confirmed by the new workflow. Migration SHALL move them to pending review (`role = null` and `classificationStatus = 'PENDING_REVIEW'`, or equivalent) while preserving descriptions, account links, and rule links.

#### Scenario: Legacy OTRO becomes pending review

- GIVEN an existing EntityContext with role `OTRO`
- WHEN the migration runs
- THEN role is cleared and classification status becomes pending review
- AND pattern, userDescription, glAccountId, and linked BankRules are preserved

#### Scenario: Existing description enriches prompt

- GIVEN a legacy OTRO context has userDescription
- WHEN enriched reclassification is requested
- THEN the description is included as context in the prompt
- AND the suggestion still requires operator confirmation

#### Scenario: Legacy linked automation is safe

- GIVEN a legacy OTRO context has a linked BankRule or glAccount
- WHEN migration and reclassification run
- THEN the link is not silently deleted or overwritten
- AND the entity is marked or surfaced as needing review before automation changes

## MODIFIED Requirements

### Requirement: Auto-Create BankRule on Classification

After `classifyEntity()` saves an EntityContext from an explicit user confirmation, it MUST auto-create or update a BankRule with: `pattern`, confirmed `glAccountId`, inferred `transactionDirection` using canonical direction classification, `priority=5`, `isActive=true`, `entityContextId`, and optional confirmed intent. The system MUST NOT auto-create a BankRule from provisional, AI-only, unconfirmed, low-confidence, or final `OTRO` suggestions.
(Previously: classification could auto-create a BankRule after saving an EntityContext, with source guard only for AI suggestions.)

#### Scenario: Confirmed classification creates BankRule

- GIVEN the user confirms a smart suggestion with role, intent, and GL account
- WHEN classification is saved
- THEN a BankRule is created or updated for the EntityContext
- AND direction is inferred from the confirmed entity history

#### Scenario: Direction inference — credit dominant

- GIVEN confirmed history has creditPct >= 0.8 and debitPct < 0.2
- WHEN auto-create computes direction
- THEN `transactionDirection = "credit"`

#### Scenario: Direction inference — mixed

- GIVEN confirmed history has no dominant direction
- WHEN auto-create computes direction
- THEN `transactionDirection = "any"`

#### Scenario: GL account not found during auto-create — classification persists, warning returned

- GIVEN confirmed classification references a missing GL account
- WHEN auto-create runs
- THEN the EntityContext remains persisted
- AND no BankRule is created and a warning is returned

#### Scenario: Active rule with same `entityContextId` → skip

- GIVEN an active BankRule exists for the same EntityContext
- WHEN confirmed classification triggers auto-create
- THEN no new rule is created and the existing active rule is unchanged

#### Scenario: Inactive rule with same `entityContextId` → reactivate + update

- GIVEN an inactive BankRule exists for the same EntityContext
- WHEN confirmed classification triggers auto-create
- THEN the existing rule is reactivated and updated from confirmed values

#### Scenario: Manual rule with same pattern — no dedup by pattern

- GIVEN a manual BankRule with the same pattern and null entityContextId
- WHEN confirmed classification creates a rule
- THEN the manual rule is not modified
- AND any new rule is linked by entityContextId

#### Scenario: autoCreateRule includes intent value

- GIVEN confirmed classification includes an intent
- WHEN auto-create creates or updates a BankRule
- THEN the rule includes that intent
- AND missing intent persists as null

#### Scenario: Unconfirmed suggestion creates no rule

- GIVEN a smart suggestion exists but the user has not confirmed it
- WHEN classification processing completes
- THEN no BankRule is created or modified
- AND no accounting automation runs

#### Scenario: Legacy OTRO suggestion creates no rule

- GIVEN a migrated legacy OTRO context has a pending enriched suggestion
- WHEN the operator has not confirmed the new classification
- THEN no BankRule is created, activated, deleted, or modified
- AND any existing linked rule remains reviewable but unchanged

#### Scenario: Final OTRO is blocked

- GIVEN the selected role is `OTRO`
- WHEN the user attempts final confirmation
- THEN the save is blocked or routed to review
- AND no final `OTRO` classification is persisted
