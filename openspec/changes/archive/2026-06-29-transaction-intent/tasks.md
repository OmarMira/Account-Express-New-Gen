# Tasks: Transaction Intent — Change #4

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| **Total phases** | 7 |
| **Total tasks** | 20 |
| **Estimated lines changed** | ~415 |
| **400-line budget risk** | **Medium** — right at the threshold, UI + tests add bulk |
| **Files touched** | 12 (8 modified, 3 new, 1 auto-generated) |
| **Chained PRs recommended** | **Yes** — 3 PRs by functional isolation (not size). PR #1: Foundation + i18n + types + consistency tests (~90 lines). PR #2: Backend services + routes + LLM guard (~120 lines). PR #3: UI + component tests (~140 lines). Each PR is independently mergeable with its own tests. |
| **High-risk areas** | EntityOnboardingModal (complex component with split UI, mocks), Prisma migration on optional field |
| **Decision needed before apply** | No — spec and design are fully settled |
| **Reviewer notes** | Focus review on: (1) suggest-role confidence cap location, (2) source guard in classifyEntity, (3) test mock compatibility with dual `<Select>` instances |

---

## Phase A: Foundation — Shared Constants + Database

Goal: Create the single source of truth for TransactionIntent at both the TS/Zod layer and the Prisma/DB layer. This phase is the prerequisite for all others.

### A.1 Create shared constants file [x]

**File:** `src/lib/constants/transaction-intent.ts` (NEW)

**Description:** Create the shared TransactionIntent const array, Zod schema, and derived TypeScript type.

**Acceptance criteria:**
- `TRANSACTION_INTENT_VALUES` exported as `const` array with exactly 8 values in this order: `LOAN_PAYMENT`, `RENT_PAYMENT`, `OPERATING_EXPENSE`, `OWNER_CONTRIBUTION`, `CUSTOMER_PAYMENT`, `TRANSFER`, `TAX_PAYMENT`, `OTHER`
- `transactionIntentSchema` exported as `z.enum(TRANSACTION_INTENT_VALUES)` — validates runtime values
- `TransactionIntent` type derived as `(typeof TRANSACTION_INTENT_VALUES)[number]`
- Follows the same pattern as `entity-roles.ts` (const array → Zod enum → type)
- No bilingual label map — labels live in i18n locale files only

**Design reference:** design.md §2.1

### A.2 Add Prisma enum + BankRule intent field [x]

**File:** `prisma/schema.prisma` (MODIFIED)

**Description:** Add `enum TransactionIntent` with the same 8 values and an optional `intent TransactionIntent?` field on the `BankRule` model.

**Acceptance criteria:**
- New `enum TransactionIntent { LOAN_PAYMENT RENT_PAYMENT ... OTHER }` block in schema
- `intent TransactionIntent?` added to `BankRule` model — nullable, no default, no `NOT NULL`
- Existing fields on `BankRule` are untouched
- `prisma db validate` passes
- The `intent` field is explicitly NOT referenced anywhere in `rule-matching-engine.ts`

**Design reference:** design.md §2.2, spec 02 §SCEN-INTENT-01

### A.3 Generate migration [x]

**File:** `prisma/migrations/` (NEW — auto-generated)

**Description:** Run `prisma migrate dev --name add_transaction_intent` to generate the non-destructive migration.

**Acceptance criteria:**
- Migration creates native PostgreSQL enum type `"TransactionIntent"`
- Migration runs `ALTER TABLE "BankRule" ADD COLUMN "intent" "TransactionIntent"` — nullable, no backfill
- No data loss — existing rows get `intent = null`
- Rollback possible by reverting schema and generating a down migration

**Design reference:** design.md §2.2, spec 01 §SCEN-ENUM-04

---

## Phase B: i18n Keys

Goal: Add bilingual labels for all 8 intent values plus UI labels for the learning module. This decouples locale work from component work.

### B.1 Add English locale keys [x]

**File:** `src/i18n/locales/en.ts` (MODIFIED)

**Description:** Add `transactionIntent.*` flat keys for all 8 values and `learning.*` keys for intent and actor type labels.

**Keys to add:**
```
transactionIntent.LOAN_PAYMENT = "Loan Payment"
transactionIntent.RENT_PAYMENT = "Rent Payment"
transactionIntent.OPERATING_EXPENSE = "Operating Expense"
transactionIntent.OWNER_CONTRIBUTION = "Owner Contribution"
transactionIntent.CUSTOMER_PAYMENT = "Customer Payment"
transactionIntent.TRANSFER = "Transfer"
transactionIntent.TAX_PAYMENT = "Tax Payment"
transactionIntent.OTHER = "Other"

learning.intentLabel = "Transaction Intent"
learning.intentPlaceholder = "Select intent (optional)"
learning.actorTypeLabel = "Actor Type"
learning.splitReasoning = 'No rule matching pattern "{pattern}" found. Suggested intent: {intent}.'
```

**Design reference:** design.md §2.3

### B.2 Add Spanish locale keys [x]

**File:** `src/i18n/locales/es.ts` (MODIFIED)

**Description:** Add Spanish translations for all `transactionIntent.*` and `learning.*` keys.

**Keys to add:**
```
transactionIntent.LOAN_PAYMENT = "Pago de Préstamo"
transactionIntent.RENT_PAYMENT = "Pago de Renta"
transactionIntent.OPERATING_EXPENSE = "Gasto Operativo"
transactionIntent.OWNER_CONTRIBUTION = "Aporte del Dueño"
transactionIntent.CUSTOMER_PAYMENT = "Pago de Cliente"
transactionIntent.TRANSFER = "Transferencia"
transactionIntent.TAX_PAYMENT = "Pago de Impuesto"
transactionIntent.OTHER = "Otro"

learning.intentLabel = "Intención de la Transacción"
learning.intentPlaceholder = "Seleccionar intención (opcional)"
learning.actorTypeLabel = "Tipo de Actor"
learning.splitReasoning = 'No se encontró regla para el patrón "{pattern}". Intención sugerida: {intent}.'
```

**Design reference:** design.md §2.3

---

## Phase C: Service Layer — entity-classifier

Goal: Wire the intent field through the classification service. `ClassifyEntityInput`, `autoCreateRule()`, and `classifyEntity()` all gain intent support.

### C.1 Update ClassifyEntityInput interface [v] (verified constants exports - PR #1)

**File:** `src/lib/services/entity-classifier.ts` (MODIFIED)

**Description:** Add optional `intent?: TransactionIntent | null` to the `ClassifyEntityInput` interface.

**Acceptance criteria:**
- `intent` field is optional, accepts `TransactionIntent | null | undefined`
- No existing callers break (optional field is backward-compatible)
- TypeScript compiles without errors

**Design reference:** design.md §3.3

### C.2 Update autoCreateRule to accept and persist intent [x]

**File:** `src/lib/services/entity-classifier.ts` (MODIFIED)

**Description:** Add `intent?: TransactionIntent | null` parameter to `autoCreateRule()`. Pass it through to `prisma.bankRule.create()`.

**Acceptance criteria:**
- `autoCreateRule()` signature gains `intent?: TransactionIntent | null`
- `prisma.bankRule.create()` call includes `intent: intent ?? null`
- When intent is provided, the rule is created with that intent value
- When intent is omitted/undefined, the rule is created with `intent = null`
- Direction parameter and existing fields are unchanged

**Design reference:** design.md §2.6

### C.3 Add source guard in classifyEntity [x]

**File:** `src/lib/services/entity-classifier.ts` (MODIFIED)

**Description:** In `classifyEntity()`, wrap the `autoCreateRule()` call in a guard that only auto-creates when `source === 'user'`. LLM/AI suggestions (`source: 'ai'`) must NOT auto-create rules.

**Acceptance criteria:**
- `classifyEntity()` checks `input.source` before calling `autoCreateRule()`
- When `source === 'user'`: `autoCreateRule()` is called with intent (pass-through)
- When `source === 'ai'` or `source` is undefined/null: `autoCreateRule()` is NOT called
- The function still saves the entity context regardless of source
- The intent value is still passed through when autoCreateRule IS called

**Design reference:** design.md §2.9.3, spec 05 §REQ-SPLIT-03

---

## Phase D: API Layer — classify-entity route

Goal: Accept and validate intent in the classify-entity API endpoint, then pass it to the service layer.

### D.1 Accept and validate intent in request body [x]

**File:** `src/app/api/learning/classify-entity/route.ts` (MODIFIED)

**Description:** Destructure `intent` from the request body. Validate with `transactionIntentSchema` if provided. Return 400 for invalid values.

**Acceptance criteria:**
- `intent` field accepted in request body JSON
- When `intent` is provided and valid (one of the 8 enum values): pass through to `classifyEntity()`
- When `intent` is provided and invalid: return `NextResponse.json({ error: 'Invalid intent value' }, { status: 400 })`
- When `intent` is omitted/null: pass `null` to `classifyEntity()`
- No other changes to the route handler

**Design reference:** design.md §2.5, spec 02 §SCEN-INTENT-04

### D.2 Pass intent through to classifyEntity [x]

**File:** `src/app/api/learning/classify-entity/route.ts` (MODIFIED)

**Description:** Include the (validated or null) intent value in the `classifyEntity()` call parameters.

**Acceptance criteria:**
- The `classifyEntity()` call includes `intent` in the input object
- No regression — existing fields still pass through correctly
- Integration with the source guard in C.3 works correctly

**Design reference:** design.md §2.5

---

## Phase E: API Layer — LLM Guard + Reasoning

Goal: Enforce server-side confidence cap on all LLM suggestions. Add reasoning field for split context. Ensure apply-all suggestion path skips LOW items.

### E.1 Cap all LLM confidence at 0.69 in suggest-role [x]

**File:** `src/app/api/learning/suggest-role/route.ts` (MODIFIED)

**Description:** Before the final response, apply `Math.min(aiResult.confidence, 0.69)` to ALL LLM-generated results. Apply the cap at a single point right before the final return to make the guard foolproof.

**Acceptance criteria:**
- Any LLM suggestion with original confidence >= 0.7 gets capped to 0.69
- Any LLM suggestion with original confidence < 0.7 preserves its value (Math.min is a no-op)
- The original confidence value from the LLM is NOT exposed to the client
- If there's a separate web-search cap at ~line 317, the final return cap at 0.69 supersedes it (single-point cap is the recommended approach)
- The confidence cap is SERVER-SIDE only — no frontend can bypass it

**Design reference:** design.md §2.7, spec 04 §SCEN-LLM-01

### E.2 Add reasoning field to suggest-role response [x]

**File:** `src/app/api/learning/suggest-role/route.ts` (MODIFIED)

**Description:** Include a `reasoning` string in the response explaining why no local match exists.

**Acceptance criteria:**
- Response JSON includes `reasoning` field
- Content explains why no existing rule matched (e.g., `'No rule matching pattern "' + description + '" found. Suggested role: ' + aiResult.role + '.'`)
- The reasoning field is localized — uses the `learning.splitReasoning` i18n key via `t()` or equivalent
- Backward-compatible — existing consumers that don't read `reasoning` continue to work

**Design reference:** design.md §2.9.1, spec 05 §SCEN-SPLIT-03

### E.3 Verify/add safety filter in apply-all suggestion path [x]

**File:** `src/app/api/bank-rules/apply-all/route.ts` or `src/app/api/learning/apply-all/route.ts` (VERIFY/MODIFY)

**Description:** The deterministic rule matching engine does NOT produce confidence scores. However, if there is a separate apply-all endpoint for the LLM suggestion flow, ensure it skips items with `confidence < 0.7`.

**Acceptance criteria:**
- Confirm whether a separate apply-all endpoint exists for the learning/suggestion flow (not the deterministic rule matcher)
- If it exists: add filter `if (item.confidence < 0.7) skip` before processing
- If it doesn't exist (LLM suggestions flow only through suggest-role → classify-entity with user confirmation): no changes needed, document in a code comment
- Deterministic Apply All path is untouched — no confidence field to check
- Response summary reports count of skipped items (if any)

**Design reference:** design.md §2.8, spec 04 §REQ-LLM-02

---

## Phase F: UI — EntityOnboardingModal

Goal: Add Actor Type badge and intent dropdown to each entity card. Wire intent state through to classify API calls.

### F.1 Add per-entity intent selection state [x]

**File:** `src/components/learning/EntityOnboardingModal.tsx` (MODIFIED)

**Description:** Add `useState<Record<string, TransactionIntent | null>>` for per-entity intent tracking, keyed by canonical name.

**Acceptance criteria:**
- State initialized as empty object `{}`
- Setter function `handleIntentChange(name, value)` updates state per entity
- When entity is removed or reset, corresponding intent is also cleared
- Type-safe: values are `TransactionIntent | null` (not plain strings)

**Design reference:** design.md §2.4.1

### F.2 Add Actor Type badge + direction hint [x]

**File:** `src/components/learning/EntityOnboardingModal.tsx` (MODIFIED)

**Description:** Inside each entity card, above the role selector, show a read-only badge displaying the raw role name (e.g., "INQUILINO") with a subtle direction hint below it.

**Implementation details:**
- `getActorType(role)`: returns the role name as-is for display, or `null` for `OTRO`/`IGNORADA`/no role
- `getDirectionHint(role)`: returns `"Expected: Income"` or `"Expected: Expense"` from `EXPECTED_DIRECTION`, or `null` when direction is `mixed`/`null`
- Badge uses muted styling (no border, no hover effect, distinct from editable controls)
- Direction hint is subtle text below the badge (e.g., `text-xs text-muted-foreground`)
- No badge shown when no role is selected
- Badge updates automatically when role changes

**Acceptance criteria:**
- Actor Type badge renders when a role is selected
- Badge shows raw role name (e.g., "INQUILINO", "PROVEEDOR"), not an abstract category
- Direction hint shows below badge for roles with a single expected direction
- No badge/hint for OTRO or IGNORADA roles
- Badge is purely decorative/read-only — no click interaction
- Layout remains compact within `max-w-3xl` modal

**Design reference:** design.md §2.4.2, spec 03 §SCEN-UI-01

### F.3 Add intent dropdown Select [x]

**File:** `src/components/learning/EntityOnboardingModal.tsx` (MODIFIED)

**Description:** Add a `<Select>` dropdown after the role selector with bilingual intent options. One dropdown per entity card.

**Implementation details:**
- Uses the same `shadcn/ui <Select>` pattern as the existing role selector
- Options populated from `TRANSACTION_INTENT_VALUES`
- Each option label uses `t('transactionIntent.{VALUE}')` for bilingual display
- First option is empty/unset placeholder from `t('learning.intentPlaceholder')`
- Compact variant: `h-8 text-sm` trigger, same size as role selector
- Disabled when `saving` is true
- Optional — no blocking or warning when unset

**Acceptance criteria:**
- Intent dropdown renders after role selector, before OTRO textarea
- Dropdown shows all 8 intent values with bilingual labels
- Dropdown has a visible placeholder "Select intent (optional)"
- Empty/unset first option allows clearing the selection
- Intent can be left unset without any validation error or warning
- Per-entity: different entities can have different intents

**Design reference:** design.md §2.4.3, spec 03 §SCEN-UI-02, §SCEN-UI-03

### F.4 Pass intent to classify API calls [x]

**File:** `src/components/learning/EntityOnboardingModal.tsx` (MODIFIED)

**Description:** Include `intent: intentSelections[name] ?? null` in both `handlePreClassify()` and `handleClassifyAll()` API call bodies.

**Acceptance criteria:**
- `POST /api/learning/classify-entity` request body includes `intent` field
- When intent is selected: `intent: "RENT_PAYMENT"` (or whichever value)
- When intent is not selected: `intent: null`
- Both `handlePreClassify()` (auto-save non-OTRO) and `handleClassifyAll()` (save all) pass intent
- Existing API call fields remain unchanged
- No other changes to API call structure

**Design reference:** design.md §2.4.4, spec 03 §SCEN-UI-04

---

## Phase G: Tests

Goal: Ensure enum consistency between Zod and Prisma. Verify LLM confidence cap, source guard, and UI behavior.

### G.1 Enum consistency test + Zod validation [x]

**File:** `tests/constants/transaction-intent.test.ts` (NEW)

**Description:** Create test that compares `TRANSACTION_INTENT_VALUES` against Prisma's `Object.values(TransactionIntent)` to catch enum drift. Add Zod validation tests.

**Test cases:**
1. **Consistency**: `expect(Object.values(TransactionIntent).sort()).toEqual([...TRANSACTION_INTENT_VALUES].sort())` — fails if values differ between TS const and Prisma enum
2. **Valid Zod parse**: `transactionIntentSchema.parse('LOAN_PAYMENT')` succeeds for all 8 values
3. **Invalid Zod parse**: `transactionIntentSchema.parse('INVALID')` throws ZodError
4. **Type narrowing**: ensure derived type only accepts valid enum values at compile time

**Design reference:** design.md §2.1, §5.4, spec 01 §SCEN-ENUM-02b

### G.2 API and service layer tests [x]

**Files:** Extend `tests/api/suggest-role.test.ts` and `tests/services/entity-classifier.test.ts`

**Description:** Test the LLM confidence cap at the API boundary. Test autoCreateRule with and without intent. Test source guard.

**Test cases for suggest-role (new or extended file):**
1. LLM returns confidence 0.95 → response has `confidence: 0.69`
2. LLM returns confidence 0.45 → response has `confidence: 0.45` (unchanged)
3. LLM returns confidence 0.69 → response has `confidence: 0.69` (unchanged)
4. Response includes `reasoning` field with non-empty string

**Test cases for entity-classifier (extend existing file):**
1. `autoCreateRule()` with intent → rule created with that intent value
2. `autoCreateRule()` without intent → rule created with `intent = null`
3. `classifyEntity()` with `source: 'user'` → calls `autoCreateRule()`
4. `classifyEntity()` with `source: 'ai'` → does NOT call `autoCreateRule()`
5. `classifyEntity()` with `source: undefined` → does NOT call `autoCreateRule()`

**Design reference:** design.md §5.1, §5.2, spec 04 §SCEN-LLM-01, spec 02 §SCEN-INTENT-04, spec 04 §SCEN-LLM-03

### G.3 Component test updates [x]

**File:** `tests/components/EntityOnboardingModal.test.tsx` (MODIFIED)

**Description:** Update the mock to handle dual `<Select>` instances (role + intent). Add test cases for Actor Type and intent dropdown.

**Test cases:**
1. Actor Type badge is visible when a role is selected
2. Actor Type badge is hidden when no role is selected
3. Actor Type updates when role changes
4. Intent dropdown renders with placeholder and 8 options
5. Selecting an intent updates component state
6. Entity can be classified without selecting intent (optional)
7. When intent is selected and classify is clicked, API call includes `intent` field

**Design reference:** design.md §5.3, design.md §2.4.5

---

## Implementation Order (Dependency Graph)

```
Phase A (Foundation)
  ├── A.1 Constants file ───┐
  ├── A.2 Prisma schema ─────┤
  └── A.3 Migration ─────────┘
           │
           ▼
Phase B (i18n Keys)
           │
           ▼
Phase C (Service Layer) ──── G.2 (Service tests)
           │
           ├── D (classify-entity route)
           └── E (LLM guard)
                    │
                    ▼
Phase F (UI) ─────────────── G.3 (Component tests)
           │
           ▼
G.1 (Enum consistency) ─── can be done any time after A.1
```

## Delivery Notes

- **Single PR** is safe — all changes are additive, non-destructive, and backward-compatible
- **Risk areas**: EntityOnboardingModal is a complex component with split UI — changes there need careful review of existing state management and mock compatibility
- **No changes to**: `rule-matching-engine.ts`, `rules/entity-roles.json`, `src/app/api/bank-rules/route.ts`
- **TDD**: Write tests in G.1 and G.2 before or alongside their implementation phases
