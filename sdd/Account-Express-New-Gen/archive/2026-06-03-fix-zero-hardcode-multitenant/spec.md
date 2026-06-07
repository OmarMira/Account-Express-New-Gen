# Delta Spec: Fix Hardcoded Fallbacks & Enforce Multitenant Isolation

## Domain: transaction-categorization-heuristics

### MODIFIED Requirements

#### Requirement: Heuristic Prioritization Ordering

The system MUST dynamically determine conversational classification priorities, keyword dictionaries, and target accounts from `rules/assistant-config.json`. The matching logic MUST NOT contain hardcoded rules, values, or precedence hierarchies. Role keywords (e.g., `SOCIO`) SHALL be prioritized over transaction type keywords (e.g., `GASTO`) if defined in the config.
(Previously: Heuristic matching prioritized hardcoded transaction type rules 'gasto'/'ingreso' over roles in `localHeuristicParse`.)

##### Scenario: Prioritize Role Over Type

- GIVEN a classification request with `userInput: "socio retiro gasto capital"`
- WHEN `localHeuristicParse` parses config with `SOCIO` priority higher than `GASTO`
- THEN it MUST return role `"SOCIO"` and account `"3010"`

##### Scenario: Fallback Default Parsing

- GIVEN a classification request with `userInput: "unknown descriptor"`
- WHEN no keywords match any configuration rules
- THEN it MUST fallback to the default role `"PROVEEDOR"` and account `"6070"`

---

## Domain: multi-tenant-isolation

### ADDED Requirements

#### Requirement: API Tenant Access Verification

The endpoints `/api/learning/feedback` (PATCH) and `/api/ai-assistant` (POST) MUST verify that the active session user has a membership record in `db.companyMember` for the target `companyId`. If no valid membership is found, the system MUST immediately abort execution and return a `403 Forbidden` error.

##### Scenario: Authorized Access

- GIVEN a user with valid session `userId: "user_123"` and membership in `company_abc`
- WHEN they request `/api/learning/feedback` with `companyId: "company_abc"`
- THEN the system MUST record the feedback and return `200 OK`

##### Scenario: Unauthorized Access Blocked

- GIVEN a user with session `userId: "user_123"` having NO membership in `company_xyz`
- WHEN they query `/api/ai-assistant` with `companyId: "company_xyz"`
- THEN the system MUST return `403 Forbidden`

---

## Domain: entity-extraction

### MODIFIED Requirements

#### Requirement: Complete Entity Extraction

The entity extraction engine MUST identify all candidate entities from raw transaction descriptions using regex patterns defined in `rules/entity-detection.json`. The matching and clustering process MUST NOT limit, slice, or truncate the final candidate list, ensuring that all candidate entities meeting the minOccurrences threshold are successfully returned.
(Previously: The regex rules truncated lookaheads and the engine had an implicit limit on extracted entities.)

##### Scenario: Extraction and Clustering of All Entities

- GIVEN a list of 10 different raw transactions matching regex rules
- WHEN `clusterCandidates` is called with `minOccurrences: 2`
- THEN it MUST extract and return all candidates without truncation or a 3-entity limit
