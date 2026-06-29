# Design: Transaction Intent — Change #4

## 1. Architecture Overview

### 1.1 Layered Ownership

```
Constants Layer (src/lib/constants/transaction-intent.ts)
  │
  ├── Zod enum schema ──────────┐  Runtime validation (API, UI)
  ├── TS type derived ──────────┤  TypeScript type safety
  └── Bilingual label map ──────┘  Consumed by i18n locale files

Prisma Layer (prisma/schema.prisma)
  │
  ├── enum TransactionIntent ───┐  Native PostgreSQL enum
  └── BankRule.intent? ─────────┤  Optional field, nullable

API Layer
  │
  ├── suggest-role ─────────────┤  Confidence cap at 0.69
  ├── apply-all ────────────────┤  Skip items < 0.7
  └── classify-entity ──────────┤  Accept optional intent param

UI Layer (EntityOnboardingModal)
  │
  ├── Actor Type badge ─────────┤  Read-only, derived from role
  └── Intent Select ────────────┤  Optional, bilingual labels
```

### 1.2 Data Flow for Intent Classification

```
User selects Role → Actor Type badge derived (read-only)
User optionally selects Intent → stored in component state
User clicks "Classify" → POST /api/learning/classify-entity
  → classifyEntity() → saveContext() + autoCreateRule()
  → BankRule created with intent = selected value (or null)
```

### 1.3 Data Flow for LLM Suggestions

```
POST /api/learning/suggest-role → LLM returns { role, confidence, explanation }
  → Server-side caps confidence to Math.min(original, 0.69)
  → Frontend receives confidence <= 0.69
  → Apply All skips any item with confidence < 0.7
  → User sees "Low confidence" badge
  → User must manually "Accept" before rule is created
```

### 1.4 Key Design Principle

The `intent` field is stored on `BankRule` but is NEVER read by the matching engine (`rule-matching-engine.ts`) in this change. This is explicitly enforced by a negative spec (Domain 6). Intent-based matching is deferred to a future change.

---

## 2. Component Designs

### 2.1 Constants File: `src/lib/constants/transaction-intent.ts` (NEW)

```typescript
import { z } from 'zod';

export const TRANSACTION_INTENT_VALUES = [
  'LOAN_PAYMENT',
  'RENT_PAYMENT',
  'OPERATING_EXPENSE',
  'OWNER_CONTRIBUTION',
  'CUSTOMER_PAYMENT',
  'TRANSFER',
  'TAX_PAYMENT',
  'OTHER',
] as const;

export type TransactionIntent = (typeof TRANSACTION_INTENT_VALUES)[number];

export const transactionIntentSchema = z.enum(TRANSACTION_INTENT_VALUES);
```

**Design notes:**
- Follows the exact same pattern as `entity-roles.ts` (const array → Zod enum → type).
- The const array is the TypeScript source of truth.
- Prisma enum must be maintained separately; the consistency test catches drift.
- No bilingual label map in the constants file — labels live in i18n locale files as flat keys.

### 2.2 Prisma Schema Changes

**New enum:**
```prisma
enum TransactionIntent {
  LOAN_PAYMENT
  RENT_PAYMENT
  OPERATING_EXPENSE
  OWNER_CONTRIBUTION
  CUSTOMER_PAYMENT
  TRANSFER
  TAX_PAYMENT
  OTHER
}
```

**Modified BankRule model:**
```prisma
model BankRule {
  id                   String            @id @default(cuid())
  // ... existing fields unchanged ...
  intent               TransactionIntent?  // NEW — optional, nullable
  // ... rest unchanged ...
}
```

**Migration behavior:**
- `prisma migrate dev` generates `ALTER TABLE "BankRule" ADD COLUMN "intent" "TransactionIntent"`
- Column is nullable, no default value, no NOT NULL constraint
- No backfill needed — all existing rows get `intent = null`
- Rollback: revert schema, generate a second migration dropping the column and enum type with CASCADE

### 2.3 i18n Changes

**Pattern:** Flat keys per locale file, same structure as existing `learning.*` keys.

**`en.ts` additions:**
```typescript
const en = {
  // ... existing keys ...
  transactionIntent: {
    LOAN_PAYMENT: 'Loan Payment',
    RENT_PAYMENT: 'Rent Payment',
    OPERATING_EXPENSE: 'Operating Expense',
    OWNER_CONTRIBUTION: 'Owner Contribution',
    CUSTOMER_PAYMENT: 'Customer Payment',
    TRANSFER: 'Transfer',
    TAX_PAYMENT: 'Tax Payment',
    OTHER: 'Other',
  },
  learning: {
    // ... existing keys ...
    intentLabel: 'Transaction Intent',
    intentPlaceholder: 'Select intent (optional)',
    actorTypeLabel: 'Actor Type',
    splitReasoning: 'No rule matching pattern "{pattern}" found. Suggested intent: {intent}.',
  },
  // ... rest unchanged ...
};
```

**`es.ts` additions:**
```typescript
transactionIntent: {
  LOAN_PAYMENT: 'Pago de Préstamo',
  RENT_PAYMENT: 'Pago de Renta',
  OPERATING_EXPENSE: 'Gasto Operativo',
  OWNER_CONTRIBUTION: 'Aporte del Dueño',
  CUSTOMER_PAYMENT: 'Pago de Cliente',
  TRANSFER: 'Transferencia',
  TAX_PAYMENT: 'Pago de Impuesto',
  OTHER: 'Otro',
},
learning: {
  // ... existing keys ...
  intentLabel: 'Intención de la Transacción',
  intentPlaceholder: 'Seleccionar intención (opcional)',
  actorTypeLabel: 'Tipo de Actor',
  splitReasoning: 'No se encontró regla para el patrón "{pattern}". Intención sugerida: {intent}.',
},
```

### 2.4 EntityOnboardingModal Changes

#### 2.4.1 State Additions

```typescript
// Per-entity intent selection (canonicalName → TransactionIntent | null)
const [intentSelections, setIntentSelections] = useState<
  Record<string, TransactionIntent | null>
>({});
```

#### 2.4.2 Actor Type Badge

**Where:** Inside each entity card, above the role `<Select>`.

**Logic:**
```typescript
function getActorType(role: string): string | null {
  const expectedDir = EXPECTED_DIRECTION[role as EntityRole];
  if (expectedDir === undefined || role === 'OTRO' || role === 'IGNORADA') return null;
  return role; // Show the actual role name (e.g., "INQUILINO") as the actor context
}

function getDirectionHint(role: string): string | null {
  const expectedDir = EXPECTED_DIRECTION[role as EntityRole];
  if (expectedDir === null || expectedDir === 'mixed') return null;
  return expectedDir === 'credit' ? 'Expected: Income' : 'Expected: Expense';
}
```

**When no role selected:** No badge shown.
**When a role is selected:** Shows the role name as a muted badge — "INQUILINO", "PROVEEDOR", etc. This is the actual actor type, not a simplified label.
**Direction hint (optional):** Below the badge, show a subtle "Expected: Income" or "Expected: Expense" text derived from `EXPECTED_DIRECTION`. This gives the user context about which direction the system expects for that role.
**Updates automatically:** When role changes, the badge updates.
**Design rationale:** Using the raw role name as Actor Type is more informative than abstract categories like "Income Source" or "Expense Source". The user already knows what PROVEEDOR means — they don't need a translation to a generic category.

#### 2.4.3 Intent Dropdown

**Where:** After the role selector, before the OTRO textarea.

**Component:**
```tsx
<div className="mt-1.5">
  <label className="text-xs text-muted-foreground mb-1 block">
    {t('learning.intentLabel')}
  </label>
  <Select
    value={intentSelections[name] ?? ''}
    onValueChange={(v) => handleIntentChange(name, v === '' ? null : v as TransactionIntent)}
    disabled={saving}
  >
    <SelectTrigger className="h-8 text-sm">
      <SelectValue placeholder={t('learning.intentPlaceholder')} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">{t('learning.intentPlaceholder')}</SelectItem>
      {TRANSACTION_INTENT_VALUES.map((intent) => (
        <SelectItem key={intent} value={intent}>
          {t(`transactionIntent.${intent}`)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

**Behavior:**
- First option is empty/unset placeholder
- All 8 intents shown with bilingual labels via `t('transactionIntent.${intent}')`
- Intent is PER ENTITY CARD (each entity can have different intent)
- Optional — leaving it unset does not warn or block

#### 2.4.4 Intent Passed to Classify Endpoint

**When calling `POST /api/learning/classify-entity`:**

Both in `handlePreClassify()` (auto-save non-OTRO) and `handleClassifyAll()` (save all):
```typescript
body: JSON.stringify({
  companyId,
  pattern: name,
  role: finalRole,
  intent: intentSelections[name] ?? null,  // NEW
  // ... existing fields ...
})
```

#### 2.4.5 Existing Test Mock Must Be Updated

The Select mock at `EntityOnboardingModal.test.tsx` already renders ALL_ROLES as options. When adding the intent dropdown, the test must:
- Add a second `<select>` mock instance for the intent values
- OR enhance the mock to differentiate by label/placeholder
- Add test cases for Actor Type badge visibility and intent selection

### 2.5 Classify Entity Route — Accept Intent

**File:** `src/app/api/learning/classify-entity/route.ts`

**Changes:**
1. Destructure `intent` from request body.
2. Pass `intent` to `classifyEntity()`.
3. Zod validation: if `intent` is provided, validate against `transactionIntentSchema`.

```typescript
// NEW validation
if (intent) {
  const intentResult = transactionIntentSchema.safeParse(intent);
  if (!intentResult.success) {
    return NextResponse.json(
      { error: 'Invalid intent value' },
      { status: 400 },
    );
  }
}
```

### 2.6 entity-classifier.ts — autoCreateRule Accepts Intent

**Changes to `autoCreateRule()` signature:**
```typescript
export async function autoCreateRule(
  companyId: string,
  context: { id: string; pattern: string; glAccountId: string | null },
  direction: 'debit' | 'credit' | 'any',
  intent?: TransactionIntent | null,  // NEW
): Promise<{ warning?: string }>
```

**Changes to BankRule.create:**
```typescript
await tx.bankRule.create({
  data: {
    // ... existing fields ...
    intent: intent ?? null,  // NEW — nullable
  },
});
```

**Changes to `classifyEntity()` signature:**
```typescript
export async function classifyEntity(
  input: ClassifyEntityInput,
): Promise<{ context: EntityContext; warning?: string }>
```

`ClassifyEntityInput` gains:
```typescript
intent?: TransactionIntent | null;
```

And the `autoCreateRule` call within `classifyEntity()` passes the intent through.

### 2.7 LLM Confidence Cap — suggest-role Route

**File:** `src/app/api/learning/suggest-role/route.ts`

**Changes at line ~367 (right before the final return):**

```typescript
// ── LLM confidence cap ──────────────────────────────────────────────
// All LLM-generated suggestions are forced to max 0.69 confidence.
// This ensures they are treated as LOW by the frontend confidence gate.
if (aiResult) {
  aiResult.confidence = Math.min(aiResult.confidence, 0.69);
}

return NextResponse.json({
  suggestedRole: aiResult.role,
  confidence: aiResult.confidence,
  explanation: aiResult.explanation,
});
```

**Note:** There's already a cap for web-search enhanced results at line 317 (`Math.min(reResult.confidence, 0.70)`). The new cap applies to ALL LLM results, not just web-enhanced ones. The web-search cap should also be adjusted to 0.69 for consistency, or kept at 0.70 since web-enhanced results are treated like LLM suggestions anyway — the final return cap at 0.69 ensures it's always max 0.69.

**Recommendation:** Apply the cap at a single point — right before the final response. This simplifies and makes the guard foolproof.

### 2.8 Apply All — Skip LOW Confidence

**Important clarification:** The deterministic rule matching engine (`rule-matching-engine.ts`, `apply-all-engine.ts`) does NOT produce a `confidence` score. It produces deterministic matches: a transaction either matches a rule or it doesn't. The `confidence` field is ONLY present in the **LLM suggestion flow** (via `POST /api/learning/suggest-role`).

Therefore, the LOW confidence skip applies to:

1. **LLM suggestions** — items from `suggest-role` that have `confidence < 0.7` (all LLM suggestions are capped at 0.69, so ALL are excluded from Apply All).
2. **Deterministic matched rules** — these have NO confidence score and are processed normally by Apply All. They are NOT filtered.

**Implementation:**
```typescript
// In apply-all-engine.ts — the LLM suggestion handler (not the rule matcher):
// LLM-sourced items always have confidence <= 0.69, so they are ALL excluded.
// Only items with confidence >= 0.7 proceed to auto-apply.
// Currently, no confidence field ever reaches >= 0.7 from the LLM path,
// so the filter is a safety net for future changes.
```

**File:** `src/app/api/bank-rules/apply-all/route.ts` — no changes needed. The existing flow processes only deterministic rule matches (from `matchTransactions()`), which have no confidence field. LLM suggestions flow through a separate path (`suggest-role`/`classify-entity`) that never reaches Apply All without user confirmation.

### 2.9 Split Confirmation Flow

#### 2.9.1 Server-side: Include reasoning in suggest-role response

The `suggest-role` endpoint adds a `reasoning` field to the response:

```typescript
return NextResponse.json({
  suggestedRole: aiResult.role,
  confidence: aiResult.confidence,
  explanation: aiResult.explanation,
  reasoning: `No rule matching pattern "${description}" found. Suggested role: ${aiResult.role}.`, // NEW
});
```

#### 2.9.2 Frontend: Confirmation Card

When `autoCreateRule` detects a non-matching transaction during the classification flow (i.e., the entity doesn't match any existing rule), a confirmation card is shown instead of auto-creating the rule.

**Where:** In the batch result banner area (the existing suggestion banner pattern at EntityOnboardingModal.tsx lines 936-976).

**Card content:**
- Proposed intent (from intent dropdown selection)
- Proposed GL account name and code (from existing account selector)
- Direction (debit/credit from directionProfile)
- Entity pattern (the candidate name)
- Explanation: "No rule matching pattern 'JOHN DOE' found"
- "Confirm" button → calls api/learning/classify-entity with confirmed data
- "Dismiss" button → hides the card, no side effects

**Implementation detail:** The existing suggestion banner already has Accept/Discard pattern. The split confirmation reuses this pattern. The key change is that NO autoCreateRule is invoked until the user explicitly clicks "Confirm".

#### 2.9.3 Guard in classifyEntity()

```typescript
// Only auto-create rule if source is 'user'
if (source === 'user') {
  const { warning } = await autoCreateRule(companyId, { ... }, direction, intent);
}
```

This ensures that any suggestion flow with `source: 'ai'` never triggers `autoCreateRule`. The rule is created only when the user explicitly confirms (which sends `source: 'user'`).

---

## 3. Data Model Changes

### 3.1 New Database Enum

```sql
CREATE TYPE "TransactionIntent" AS ENUM (
  'LOAN_PAYMENT',
  'RENT_PAYMENT',
  'OPERATING_EXPENSE',
  'OWNER_CONTRIBUTION',
  'CUSTOMER_PAYMENT',
  'TRANSFER',
  'TAX_PAYMENT',
  'OTHER'
);
```

### 3.2 New Column on BankRule

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `intent` | `TransactionIntent` | Yes | `null` | Added via non-destructive migration. All existing rows get `null`. |

### 3.3 ClassifyEntityInput Interface

```typescript
export interface ClassifyEntityInput {
  companyId: string;
  pattern: string;
  role: string;
  roles?: string[];
  glAccountCode?: string;
  source?: 'user' | 'ai';
  userId?: string;
  transactionDirection?: string | null;
  userDescription?: string | null;
  intent?: TransactionIntent | null; // NEW
}
```

### 3.4 API Response Shapes

**POST /api/learning/classify-entity response:**
```json
{
  "success": true,
  "data": { "role": "INQUILINO" },
  "warning": null
}
```
No change to response shape (intent is stored server-side, not returned in this endpoint).

**POST /api/learning/suggest-role response:**
```json
{
  "suggestedRole": "INQUILINO",
  "confidence": 0.69,
  "explanation": "Matched 'JOHN DOE' as rent payment pattern",
  "reasoning": "No rule matching pattern 'JOHN DOE' found. Suggested role: INQUILINO."
}
```
Note: `confidence` capped at 0.69. New `reasoning` field for split context.

---

## 4. UI Component Layout

### Entity Card (per-entity rendering)

```
┌─────────────────────────────────────────────────────────┐
│  JOHN DOE                        12 transactions · Crédito │
│                                                         │
│  ┌── Actor ───────────────────────────────────────┐     │
│  │  INQUILINO  ·  Expected: Income          [badge]│     │
│  └──────────────────────────────────────────────────┘     │
│                                                         │
│  [ INQUILINO ▼ ]   ← Role selector (existing)           │
│                                                         │
│  ┌── Direction Warning (if applicable) ────────────┐     │
│  │  ⚠ INQUILINO expects credits but most are debits│     │
│  │  [Assign anyway]                                │     │
│  └──────────────────────────────────────────────────┘     │
│                                                         │
│  ┌── Split UI (if mixed direction) ────────────────┐     │
│  │  Create two separate entities?                   │     │
│  │  [Credits only] [Debits only] [Both (no split)]  │     │
│  └──────────────────────────────────────────────────┘     │
│                                                         │
│  ┌── Intent Select ────────────────────────────────┐     │
│  │  Transaction Intent: [Select intent (optional) ▼]│     │
│  │  │  (none)                                      │     │
│  │  │  Loan Payment                                 │     │
│  │  │  Rent Payment                                 │     │
│  │  │  Operating Expense                            │     │
│  │  │  Owner Contribution                          │     │
│  │  │  Customer Payment                            │     │
│  │  │  Transfer                                    │     │
│  │  │  Tax Payment                                 │     │
│  │  │  Other                                       │     │
│  │  └──────────────────────────────────────────────┘     │
│  └──────────────────────────────────────────────────┘     │
│                                                         │
│  ┌── OTRO textarea (if applicable) ────────────────┐     │
│  │  Describe what this entity is...                │     │
│  └──────────────────────────────────────────────────┘     │
│                                                         │
│  ┌── Suggestion Banner (if batch result) ───────────┐     │
│  │  Suggestion: PROVEEDOR              Low conf: 69% │     │
│  │  [Assign] [Discard] [Edit manually]               │     │
│  └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### Desktop Layout Note

On a `max-w-3xl` modal, the Actor Type badge and intent dropdown fit without overflow:
- Actor Type: inline badge + muted text, 1 line
- Intent dropdown: compact variant (`h-8 text-sm`), same as the role selector
- Spacing: `mt-1.5` between adjacent sections

---

## 5. Test Strategy

### 5.1 Unit Tests

| Test | File | Description |
|------|------|-------------|
| Enum consistency | `tests/constants/transaction-intent.test.ts` (NEW) | Compares `TRANSACTION_INTENT_VALUES` against `@prisma/client`'s `TransactionIntent` enum values. Fails if they differ. |
| Zod enum validation | `tests/constants/transaction-intent.test.ts` (NEW) | `transactionIntentSchema.parse('LOAN_PAYMENT')` succeeds. `transactionIntentSchema.parse('INVALID')` throws. |
| LLM confidence cap | `tests/api/suggest-role.test.ts` (NEW/EXTENDED) | POST with mock LLM returning confidence 0.95 → response has 0.69. POST with 0.45 → response has 0.45. |
| autoCreateRule with intent | `tests/services/entity-classifier.test.ts` (EXTENDED) | When intent provided, rule created with that intent. When omitted, rule has null intent. |

### 5.2 Integration Tests

| Test | Description |
|------|-------------|
| Split confirmation | POST classify-entity with `source: 'ai'` and intent → no rule auto-created. Then POST with `source: 'user'` and same intent → rule created with intent. |
| Apply All skips LOW | In apply-all flow, items with confidence < 0.7 are not applied. Response summary includes skip count. |
| Actor Type display | EntityOnboardingModal renders Actor Type badge when role selected. Badge hidden when no role. |

### 5.3 Component Tests

| Test | Description |
|------|-------------|
| Intent dropdown renders | Each entity card shows intent dropdown with 8 values + placeholder. |
| Intent optional | Entity can be saved without intent. No blocking or warning. |
| Intent passed to API | When intent selected + classify clicked, the API call includes `intent` field. |
| Actor Type updates | Change role → Actor Type badge updates accordingly. |

### 5.4 Consistency Test Detail

**File:** `tests/constants/transaction-intent.test.ts`

```typescript
import { TRANSACTION_INTENT_VALUES } from '@/lib/constants/transaction-intent';
import { TransactionIntent } from '@prisma/client';

describe('TransactionIntent consistency', () => {
  it('Zod enum matches Prisma enum values', () => {
    const prismaValues = Object.values(TransactionIntent);
    expect(prismaValues.sort()).toEqual([...TRANSACTION_INTENT_VALUES].sort());
  });
});
```

This test FAILS if:
- A value is added to `TRANSACTION_INTENT_VALUES` but not to the Prisma enum
- A value is added to the Prisma enum but not to `TRANSACTION_INTENT_VALUES`
- A value differs in spelling/case between the two

---

## 6. Affected Files

| File | Action | Description |
|------|--------|-------------|
| `src/lib/constants/transaction-intent.ts` | **NEW** | Shared enum: const array + Zod schema + type |
| `prisma/schema.prisma` | **MODIFIED** | Add `enum TransactionIntent` + `intent` field on BankRule |
| `prisma/migrations/` | **NEW** | Auto-generated non-destructive migration |
| `src/i18n/locales/en.ts` | **MODIFIED** | Add `transactionIntent.*` keys + `learning.*` intent & actor labels |
| `src/i18n/locales/es.ts` | **MODIFIED** | Add `transactionIntent.*` keys + `learning.*` intent & actor labels |
| `src/components/learning/EntityOnboardingModal.tsx` | **MODIFIED** | Actor Type badge + intent Select + intent state + pass intent to classify |
| `src/app/api/learning/classify-entity/route.ts` | **MODIFIED** | Accept `intent` param, validate with Zod, pass to classifyEntity |
| `src/lib/services/entity-classifier.ts` | **MODIFIED** | `ClassifyEntityInput` gains `intent`, `autoCreateRule` accepts intent, `classifyEntity` passes intent |
| `src/app/api/learning/suggest-role/route.ts` | **MODIFIED** | Cap ALL LLM confidence at 0.69, add `reasoning` field to response |
| `src/app/api/bank-rules/apply-all/route.ts` | **MODIFIED** | Skip items with confidence < 0.7 |
| `tests/constants/transaction-intent.test.ts` | **NEW** | Consistency test + Zod validation tests |
| `tests/components/EntityOnboardingModal.test.tsx` | **MODIFIED** | Mock intent Select, add intent + Actor Type test cases |

### Files EXPLICITLY NOT Modified

| File | Reason |
|------|--------|
| `src/lib/services/rule-matching-engine.ts` | No scoring changes per Domain 6 (negative spec) |
| `src/app/api/bank-rules/route.ts` (or equivalent) | BankRule CRUD changes deferred — intent field flows through classify flow first |
| `rules/entity-roles.json` | Roles are unchanged |

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Prisma enum drift** — developer adds value to TS const array but forgets Prisma enum | Medium | Medium — runtime error when inserting value not in DB enum | Consistency test (SCEN-ENUM-02b) fails CI build if enums drift apart |
| **LLM cap bypass** — a frontend-only cap could be bypassed by direct API calls | Low | High — LLM suggestions auto-applied | Cap is SERVER-SIDE in the suggest-role response handler. Defense in depth: frontend also checks. |
| **Migration locks on large DB** — `ALTER TABLE ... ADD COLUMN` on a table with millions of rows | Low | Medium — brief lock on production | Field is optional, no backfill. Run during low-traffic window. `ADD COLUMN` with nullable is a metadata-only operation in PostgreSQL. |
| **UI overcrowding** — Actor Type + intent dropdown + existing controls make entity cards too tall | Low | Low — user experience degradation | Both additions are compact: Actor Type is a 1-line badge, intent dropdown is same height as role selector. The cards already handled split UI + direction warnings without crowding. |
| **autoCreateRule bypass** — existing code paths that call classifyEntity bypass the intent guard | Medium | High — rule created without confirmation | Audit ALL callers of `classifyEntity()`. The classify-entity route is the only caller, and it sets `source: 'user'` which allows autoCreate. The suggest-role flow uses a separate endpoint and never calls classifyEntity. Safe by design. |
| **i18n key collision** — `transactionIntent` namespace conflicts with existing keys | Low | Low - broken build | Verify both locale files have no existing `transactionIntent` top-level key. The namespace is unique. |
| **Test mock fragility** — the existing Select mock in EntityOnboardingModal.test.tsx renders only role options | Medium | Medium — tests need update | Add a second mock or enhance mock to differentiate by rendered children. The intent dropdown uses the same `<Select>` component — test needs to distinguish between role Select and intent Select. |

---

## Appendix A: Dependency Graph

```
transaction-intent.ts (NEW) ──┐
                              ├── schema.prisma (enum + field)
prisma migrate dev ───────────┤
                              ├── migration files (NEW, auto-gen)
                              │
                  ┌───────────┘
                  ▼
i18n keys ──────► EntityOnboardingModal ───► classify-entity route ───► entity-classifier
                                                      ▲
                                                      │
suggest-role route (cap 0.69) ────────────────────────┘
                                                      │
                                                      ▼
apply-all route (skip < 0.7)
```

## Appendix B: API Contract Changes

### POST /api/learning/classify-entity

**Request (new field):**
```json
{
  "pattern": "JOHN DOE",
  "role": "INQUILINO",
  "intent": "RENT_PAYMENT",
  "source": "user",
  "companyId": "...",
  "transactionDirection": "any"
}
```

**Validation:** If `intent` is provided, it must be a valid `TransactionIntent` value. Non-enum values return 400 with `"error": "Invalid intent value"`.

### POST /api/learning/suggest-role

**Response (changes):**
- `confidence` is always <= 0.69 for LLM-generated results
- New field `reasoning` (string) — explanation of why no local match exists

**Example response:**
```json
{
  "suggestedRole": "PROVEEDOR",
  "confidence": 0.69,
  "explanation": "Entity matches vendor/supplier pattern based on transaction descriptions",
  "reasoning": "No existing rule or entity context found for 'ACME SUPPLIES'"
}
```
