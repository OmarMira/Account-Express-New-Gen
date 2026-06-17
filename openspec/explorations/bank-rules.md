## Exploration: Bank Rules

### Current State

Bank Rules is the automated transaction classification engine for AccountExpress. It categorizes bank transactions by matching them against user-defined rules, assigns GL accounts, and feeds into the reconciliation workflow. The system has evolved through multiple versions, creating significant architectural complexity.

The rule engine supports two condition models:
- **V1 (legacy)**: Single condition — `conditionType` + `conditionValue` + `glAccountId` (single account)
- **V2**: Array of `RuleCondition` objects (AND logic) with bifurcated accounts (`debitGlAccountId`/`creditGlAccountId`)

Both models coexist in the same Prisma model, API payloads, and matching engines, doubling the maintenance surface.

There are **3 separate matching engine implementations**:
1. `rule-matching-engine.ts` — used by `/api/bank-rules/[id]`, `/api/bank-rules/apply-all`, `/api/reconciliation/auto`, `/api/reconciliation/auto-preview`
2. `import.service.ts` (`applyBankRule` + `matchCondition`) — used during CSV/statement import
3. `entity-classifier.ts` — used for entity-first candidate filtering

An Entity-First pipeline provides AI-guided entity detection (SOCIO/CLIENTE/PROVEEDOR patterns) with conflict detection to prevent merchant transactions from being overridden by SOCIO rules.

### Affected Areas

#### API Routes
- `src/app/api/bank-rules/route.ts` — CRUD list/create/bulk-delete with pagination (523 lines)
- `src/app/api/bank-rules/[id]/route.ts` — Single rule GET/PUT/DELETE + apply action (421 lines)
- `src/app/api/bank-rules/apply-all/route.ts` — Apply all active rules to unmatched transactions (142 lines)
- `src/app/api/bank-rules/top-accounts/route.ts` — Top 8 most-used GL accounts in rules (50 lines)
- `src/app/api/ai-rules/scan/route.ts` — Pattern detection from transaction descriptions (316 lines)
- `src/app/api/learning/rules/route.ts` — Rule creation from entity learning (278 lines)
- `src/app/api/learning/pending-entities/route.ts` — Pending entity candidates (59 lines)
- `src/app/api/reconciliation/auto/route.ts` — Auto-reconciliation with rules + amount matching (312 lines)
- `src/app/api/reconciliation/auto-preview/route.ts` — Preview auto-reconciliation (140 lines)
- `src/app/api/ai-assistant/route.ts` — AI assistant with `get_bank_rules` tool (1340 lines total)
- `src/app/api/diagnostics/route.ts` — System diagnostics including rule counts
- `src/app/api/dashboard/workflow-status/route.ts` — Dashboard rule count
- `src/app/api/accounts/[id]/route.ts` — Cascade references on account delete (line 260)

#### Core Services
- `src/lib/services/rule-matching-engine.ts` — Central matching engine (247 lines)
- `src/lib/services/import.service.ts` — Import-time rule application (617 lines)
- `src/lib/services/entity-classifier.ts` — Entity classification for rule generation (153 lines)
- `src/lib/services/entity-detector.ts` — Entity detection and clustering (~300 lines est.)
- `src/lib/services/entity-context-service.ts` — Entity context CRUD (79 lines)
- `src/lib/services/conversational-service.ts` — AI-guided rule creation (586 lines)
- `src/lib/services/direction-validation.ts` — GL account direction profile validation (107 lines)
- `src/lib/services/pattern-normalizer.ts` — Pattern normalization
- `src/lib/accounting/fuzzy-matcher.ts` — Fuzzy matching via Fuse.js (63 lines)

#### Types & Validations
- `src/lib/types/shared.ts` — `RuleCondition`, `BankRuleWithConditions`, `ParsedRuleFromAI` types (138 lines)
- `src/lib/validations/learning-rule.ts` — Zod schema for learning rule creation (36 lines)
- `prisma/schema.prisma` — Prisma model (BankRule, lines 205-227)

#### UI Components
- `src/components/spa/BankRulesPage.tsx` — Full Bank Rules management page (878 lines)
- `src/components/spa/settings/AIRulesGeneratorTab.tsx` — AI rule generation tab
- `src/components/spa/settings/DiagnosticsTab.tsx` — Diagnostics display
- `src/components/spa/AppShell.tsx` — Navigation/sidebar routing
- `src/components/spa/AIAssistantModal.tsx` — AI assistant integration

#### Configuration
- `rules/entity-roles.json` — Role definitions (SOCIO, CLIENTE, PROVEEDOR, INQUILINO, EMPLEADO)
- `rules/entity-detection.json` — Entity detection regex/config
- `rules/bank-mapping.json` — Legacy regex-based bank mapping
- `rules/role-to-account-mapping.json` — Role to GL account code mapping
- `rules/direction-profiles.json` — Direction profile constraints
- `rules/assistant-config.json` — AI assistant configuration

#### Tests
- `tests/services/rule-matching-engine.test.ts` — Unit tests for matching engine (147 lines)
- `tests/api/bank-rules-pagination.test.ts` — API pagination tests (63 lines)
- `tests/integration/bank-rules-fase3.test.ts` — Integration tests (208 lines)
- `tests/components/BankRulesPage.test.tsx` — Component tests (156 lines)
- `tests/services/entity-first-flow.test.ts` — Entity-first integration tests (270 lines)
- `tests/services/direction-validation.test.ts` — Direction validation tests (85 lines)
- `tests/services/conversational-service.test.ts` — Conversational service tests
- `tests/services/entity-detector.test.ts` — Entity detector tests
- `tests/services/pattern-normalizer.test.ts` — Pattern normalizer tests

### Architecture Map

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer (Client)                        │
│  BankRulesPage.tsx  │  AIRulesGeneratorTab.tsx              │
│  AIAssistantModal.tsx  │  EntityOnboardingModal.tsx         │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP (fetch)
┌──────────────────────▼──────────────────────────────────────┐
│                   API Routes (Next.js)                       │
│                                                              │
│  /api/bank-rules/* ───────────┬─── CRUD + Apply             │
│  /api/ai-rules/scan ──────────┤─── Pattern scanning         │
│  /api/learning/rules ─────────┤─── Learning rule creation   │
│  /api/reconciliation/auto ────┤─── Auto-reconciliation      │
│  /api/ai-assistant ───────────┘─── AI assistant             │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Service Layer                              │
│                                                              │
│  rule-matching-engine.ts  ──── transactionMatchesRule()      │
│                              ──── evaluateWinningRule()      │
│                              ──── entityFirstCheck()         │
│                                                              │
│  import.service.ts  ────────── applyBankRule()               │
│                              ──── matchCondition()           │
│                                                              │
│  entity-classifier.ts  ─────── classifyEntity()             │
│                              ──── getEntityCandidates()      │
│                              ──── getKnownSocioPatterns()    │
│                                                              │
│  entity-detector.ts  ───────── clusterCandidates()          │
│                              ──── extractComponents()        │
│                              ──── sanitizeDescription()      │
│                                                              │
│  conversational-service.ts ─── parseConversationalContext()  │
│                              ──── localHeuristicParse()      │
│                                                              │
│  direction-validation.ts  ──── validateDirectionProfile()   │
│  pattern-normalizer.ts ─────── normalizePattern()           │
│  fuzzy-matcher.ts ──────────── runFuzzyMatch()              │
└──────────────────────┬──────────────────────────────────────┘
                       │ Prisma ORM
┌──────────────────────▼──────────────────────────────────────┐
│                   Database (SQLite via Prisma)               │
│                                                              │
│  BankRule ───── matches ──── BankTransaction                 │
│     │                                                       │
│     ├── GlAccount (legacy, debit, credit)                   │
│     │                                                       │
│  EntityContext ─── references ──── GlAccount                 │
│     │                                                       │
│  Company ─── hasMany BankRules                               │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

**Rule Creation → Matching → Classification:**

1. **Rule Creation** (3 paths):
   - **Manual**: User fills form in `BankRulesPage.tsx` → `POST /api/bank-rules` → duplicate detection (409) + overlap warnings → `db.bankRule.create` → audit log
   - **AI-assisted**: User asks assistant → `conversational-service.ts` parses intent → `POST /api/learning/rules` → optional sub-account creation → `db.bankRule.create` + entity context upsert
   - **AI scan**: `POST /api/ai-rules/scan` → scans all transactions → detects patterns ≥ 3 occurrences → returns suggestions → user confirms → `POST /api/learning/rules`

2. **Rule Persistence**: 
   - Prisma stores BankRule with V1 fields (conditionType/conditionValue/glAccountId) AND V2 fields (conditions JSON/debitGlAccountId/creditGlAccountId)
   - On create: V1 fields populated from conditions[0] if only V2 sent
   - On read: both sets returned

3. **Matching Engine** (applied in 4 contexts):
   - **Import time** (`import.service.ts`): During CSV/OFX import, each transaction matched via `applyBankRule()` → first-rule-wins by priority → sets `glAccountId` and `matchedRuleId`
   - **Single rule apply** (`POST /api/bank-rules/[id]`): Applies one rule to all unmatched transactions
   - **Apply all** (`POST /api/bank-rules/apply-all`): Applies all active rules with winner selection via `evaluateWinningRule()` (role priority + DB priority scoring)
   - **Reconciliation** (`POST /api/reconciliation/auto`): Rules matched first, then free-form amount matching against journal entries

4. **Entity-First Conflict Detection**:
   - `entityFirstCheck()` extracts merchant name from P1 and SOCIO name from INDN field in transaction description
   - If both detected, SOCIO rules are skipped for that transaction (preventing merchant payments from being classified as SOCIO draws)
   - Used in `apply-all`, `[id]/apply`, and `reconciliation/auto`

5. **Classification Result**:
   - BankTransaction gets `glAccountId` (the classified account), `matchedRuleId` (which rule matched), and eventually `isReconciled: true`
   - During reconciliation, journal entries can be auto-created from matched transactions

### Pain Points

1. **Triple Matching Engine Duplication** — `transactionMatchesRule()` in `rule-matching-engine.ts` AND `applyBankRule()`+`matchCondition()` in `import.service.ts` AND `entity-classifier.ts` all implement the same matching logic independently. The import service uses UPPERCASE (no whitespace normalization), while the engine uses lowercase with whitespace normalization. This WILL produce different results for the same transaction. Evidence: `import.service.ts` lines 465-501 vs `rule-matching-engine.ts` lines 24-62.

2. **V1/V2 Dual Model Complexity** — Every API handler, service, and consumer must check BOTH V1 and V2 fields. The Prisma model has 3 GL account fields (`glAccountId`, `debitGlAccountId`, `creditGlAccountId`) and 2 condition fields (`conditionType` string + `conditions` JSON). This doubles validation logic: `bank-rules/route.ts` has separate validation blocks for V1 (lines 167-218) and V2 (lines 119-166), with almost identical code.

3. **No Duplicate Detection on UPDATE** — `PUT /api/bank-rules/[id]` does NOT check for duplicates or overlaps with existing rules. Only `POST /api/bank-rules` does (lines 310-421). This means users can create duplicates by editing a rule to match an existing one.

4. **Silent Transaction Truncation** — `apply-all/route.ts` caps unmatched transactions at 5000 (`MAX_UNMATCHED`, line 57-61). If a company has 10,000 unmatched transactions, only 5000 are processed with no warning. The cap silently mutates the array with `.length = MAX_UNMATCHED`.

5. **`evaluateWinningRule` Role Priority Uses Disk I/O on Every Call** — `loadRolePriorities()` reads `rules/entity-roles.json` synchronously on every call (line 171-185). It caches the result in `cachedRolePriorities` but the cache never invalidates. During `apply-all`, this is called once; during `reconciliation/auto`, also once. But the cache being module-level means it persists across requests, which is fine — but the `readFileSync` on cold start blocks the event loop.

6. **Type Safety Gaps** — Multiple `as` casts: `tx as Transaction` (line 366 in [id]/route.ts, line 92 in apply-all/route.ts, line 93 in reconciliation/auto), `rule as Rule` (same locations), `bankRules as BankRuleWithConditions[]` (import.service.ts line 430). These mask real type mismatches between Prisma types and the service types.

7. **Fragmented AI Rule Detection** — `/api/ai-rules/scan` (316 lines) and `/api/learning/pending-entities` (59 lines) both scan transactions for pattern candidates with different logic. The scan route is more sophisticated (entity name extraction, role-based filtering, conflict detection) but the pending-entities route does a simpler cluster-and-filter. This is two paths to solve the same problem.

8. **No Webhook/Event for Rule Changes** — When a rule is created/updated/deleted, there's no side-effect to re-apply the changed rule to existing unmatched transactions. The user must manually click "Apply All" or wait until next import.

9. **`createLearningRuleSchema` Accepts `pattern` OR `conditions` But UI Doesn't Support V2** — The Zod schema supports both, but the BankRulesPage UI only allows single condition (conditionType + conditionValue). V2 conditions array can only be created via the API or AI learning.

10. **Import Service Bypasses `evaluateWinningRule`** — During import, `applyBankRule` uses first-rule-wins by priority (line 510), but `apply-all` and `reconciliation/auto` use `evaluateWinningRule` which considers role priority too. This inconsistency means the same transactions imported vs. bulk-applied may match different rules.

### Risks

- **Inconsistent Matching** between import and bulk-apply paths may cause user confusion when the same transactions get different GL accounts depending on when they were processed
- **Missing UPDATE deduplication** allows rule shadowing that the user won't discover until manually reviewing
- **5000 transaction cap in apply-all** silently loses auto-categorization for large portfolios
- **Module-level `readFileSync` in `loadRolePriorities`** can cause cold-start latency and never invalidates the cache if the file changes at runtime
- **Type casts obscure real bugs** — if Prisma changes its types or the service interfaces diverge, no compiler will catch it

### Testing Coverage

- **Unit**: `rule-matching-engine.test.ts` covers V1/V2 matching, direction filter, edge cases (147 lines). `direction-validation.test.ts` covers profile validation (85 lines). BUT `import.service.ts` matching (`applyBankRule`, `matchCondition`) has ZERO unit tests.

- **Integration**: `bank-rules-fase3.test.ts` covers duplicate detection (409), overlap warnings, top-accounts endpoint (208 lines). `entity-first-flow.test.ts` covers entity classification, candidate detection, conflict detection (270 lines). BUT no integration tests for `POST /api/bank-rules/[id] (apply)`, `POST /api/bank-rules/apply-all`, or `POST /api/reconciliation/auto`.

- **Component**: `BankRulesPage.test.tsx` covers rendering, loading states, empty state (156 lines). BUT no tests for form submission, error handling, bulk delete, or the apply-all dialog workflow.

- **Missing**: No E2E or full workflow tests that cover import → rule creation → matching → reconciliation in one flow.

### Ready for Proposal

Yes. The Bank Rules module has clear, actionable pain points with code evidence:

1. **Consolidate the matching engines** — unify `rule-matching-engine.ts` and `import.service.ts` into a single source of truth
2. **Add UPDATE deduplication** — mirror POST's duplicate detection in PUT
3. **Remove the silent 5000 cap** — add proper pagination or progress tracking
4. **Add V2 condition UI** — the form only supports single conditions
5. **Add integration tests for the three untested endpoints**
6. **Eliminate type casts** with proper Prisma types or type guards
7. **Add automatic re-apply on rule changes**
8. **Clean up the fragmented AI scanning** — unify `/api/ai-rules/scan` and `/api/learning/pending-entities`
