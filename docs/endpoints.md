# API Endpoints Reference

## `/api/bank-rules`
- **Purpose:** Pure CRUD for bank rules.
- **Operations:** GET (list), POST (create), PUT (update), DELETE.
- **Entity context:** Not involved.
- **Used by:** BankRulesPage, AIAssistantModal rule creation.

## `/api/learning/rules`
- **Purpose:** Atomic rule + entity context creation.
- **Operations:** POST (creates both bank rule and associated EntityContext in one transaction).
- **Used by:** EntityOnboardingModal save operations.
- **Note:** Guarantees entity+rule consistency.

## `/api/learning/classify-entity`
- **Purpose:** Legacy entity classification endpoint.
- **Phase 2 status:** POST operations still active for entity creation writes.
- **Used by:** EntityOnboardingModal POST saves (during migration).
- **Planned:** Deprecated — kept alive during Phase 2 migration.

## `/api/learning/smart-classify`
- **Purpose:** Improved candidate listing with smart clustering.
- **Operations:** GET only.
- **Algorithm:** Uses `clusterByBehavior()` for behavior-based grouping.
- **Used by:** EntityOnboardingModal candidate fetch.
