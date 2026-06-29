# Rule Matching Engine — Delta Spec

Applies to: `openspec/specs/rule-matching-engine/spec.md`

## ADDED

### Requirement: BankRule Schema Extensions

BankRule gains `entityContextId` (`String?`, FK to EntityContext, NO unique constraint) and `isManuallyEdited` (`Boolean`, `@default(false)`). GET `/api/bank-rules` MUST include `entityContextId` in the response shape. Matching logic is unaffected — these fields do not participate in rule evaluation.

#### Scenario: GET exposes `entityContextId`

- GIVEN a BankRule with `entityContextId="ctx_1"`
- WHEN GET `/api/bank-rules/[id]`
- THEN response JSON includes `entityContextId: "ctx_1"`

#### Scenario: `entityContextId` is null for manual rules

- GIVEN a manually created BankRule (no classification origin)
- WHEN fetched via GET
- THEN `entityContextId` is null

### Requirement: Differential PATCH Sets `isManuallyEdited=true`

PATCH `/api/bank-rules/[id]` MUST set `isManuallyEdited=true` when any field OTHER than `isActive` changes. Changing only `isActive` MUST NOT flip the flag.

#### Scenario: Non-isActive field change marks rule as manually edited

- GIVEN a BankRule with `isManuallyEdited=false`, `entityContextId="ctx_1"`
- WHEN PATCH updates `pattern` from `"OLD"` to `"NEW"`
- THEN `isManuallyEdited=true` is persisted

#### Scenario: Only `isActive` toggle does NOT mark manually edited

- GIVEN a BankRule with `isManuallyEdited=false`
- WHEN PATCH updates only `isActive` from `true` to `false`
- THEN `isManuallyEdited` remains `false`

### Requirement: FK Nullification on EntityContext Delete

`removeEntityContext()` and `bulkRemoveEntityContexts()` in `entity-context-crud-service.ts` MUST `UPDATE BankRule SET entityContextId=null WHERE entityContextId=<id>` BEFORE deleting the EntityContext. On FK nullification, an audit event MUST be logged recording the rule IDs and context deleted.

#### Scenario: Delete entity-context nullifies FK on linked rules

- GIVEN a BankRule with `entityContextId="ctx_1"`
- WHEN `removeEntityContext("ctx_1")` is called
- THEN `BankRule.entityContextId` is set to `null` BEFORE the EntityContext is deleted
- AND an audit event records the loss

#### Scenario: Delete with no linked rules succeeds

- GIVEN no BankRule has `entityContextId="ctx_1"`
- WHEN `removeEntityContext("ctx_1")` is called
- THEN EntityContext is deleted without side-effects

#### Scenario: Bulk delete with multiple linked rules nullifies all before delete

- GIVEN two BankRules with `entityContextId="ctx_1"` and a third with `entityContextId="ctx_2"`
- WHEN `bulkRemoveEntityContexts(["ctx_1", "ctx_2"])` is called
- THEN BankRules with `entityContextId="ctx_1"` and `entityContextId="ctx_2"` are all nullified to `null`
- AND both EntityContexts are deleted
- AND a single audit event records all affected rule IDs
