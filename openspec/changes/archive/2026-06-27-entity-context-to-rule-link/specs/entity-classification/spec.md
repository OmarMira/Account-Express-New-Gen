# Entity Classification — Delta Spec

Applies to: `openspec/specs/entity-classification/spec.md`

## ADDED

### Requirement: Auto-Create BankRule on Classification

After `classifyEntity()` saves the EntityContext, it MUST auto-create a BankRule with:
- `pattern`, `glAccountId` from classification result
- `transactionDirection` inferred from `directionProfile` (>80% debit → `debit`, >80% credit → `credit`, else `any`)
- `priority=5`, `isActive=true`, `entityContextId` set to the new EntityContext id

#### Scenario: Classification creates BankRule with inferred direction

- GIVEN `classifyEntity()` returns `{ pattern: "ACME", glAccountId: "gl_001", directionProfile: { debitPct: 0.9, creditPct: 0.1 } }`
- WHEN auto-create runs after `saveEntityContext`
- THEN a BankRule is created with `pattern="ACME"`, `glAccountId="gl_001"`, `transactionDirection="debit"`, `entityContextId` set, `priority=5`, `isActive=true`

#### Scenario: Direction inference — credit dominant

- GIVEN `directionProfile` `debitPct=0.1, creditPct=0.9`
- WHEN auto-create computes direction
- THEN `transactionDirection = "credit"`

#### Scenario: Direction inference — mixed

- GIVEN `directionProfile` `debitPct=0.6, creditPct=0.4`
- WHEN auto-create computes direction
- THEN `transactionDirection = "any"`

#### Scenario: GL account not found during auto-create — classification persists, warning returned

- GIVEN `classifyEntity()` saves EntityContext first, THEN attempts auto-create with `glAccountId="gl_missing"`
- WHEN `gl_missing` does not exist in the database
- THEN the EntityContext IS persisted (no rollback)
- AND no BankRule is created
- AND the API response includes a `warning` field (not an error) informing that the rule was not created due to missing GL account

#### Scenario: Active rule with same `entityContextId` → skip

- GIVEN an active BankRule with `entityContextId="ctx_1"` exists
- WHEN `classifyEntity()` for the same context triggers auto-create
- THEN no new rule is created and the existing rule is unchanged

#### Scenario: Inactive rule with same `entityContextId` → reactivate + update

- GIVEN an inactive BankRule with `entityContextId="ctx_1"`, `pattern="OLD"`, `glAccountId="gl_old"`
- WHEN `classifyEntity()` for context `"ctx_1"` returns `pattern="NEW"`, `glAccountId="gl_new"`
- THEN the existing rule is set to `isActive=true`, `pattern="NEW"`, `glAccountId="gl_new"`

#### Scenario: Manual rule with same pattern — no dedup by pattern (design decision)

- GIVEN a manual BankRule with `entityContextId=null`, `pattern="ACME"`, `isManuallyEdited=true`
- WHEN `classifyEntity()` returns `pattern="ACME"` for a new context `"ctx_new"`
- THEN the manual rule is NOT modified
- AND a new BankRule is created with `pattern="ACME"`, `entityContextId="ctx_new"` (dedup is by `entityContextId`, not pattern)
