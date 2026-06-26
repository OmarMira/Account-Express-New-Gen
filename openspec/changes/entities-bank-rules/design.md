# Design: entities-bank-rules

## Overview

Three incremental phases, each an autonomous PR on the tracker branch (`feat/entities-bank-rules`). Strict TDD mode — write tests before implementation. No breaking changes between phases.

---

## Phase 1: Type Fixes & Tests (No Behavior Change)

### 1.1 BankRule/RuleForm Type Changes

**File:** `src/components/spa/BankRules.tsx`

#### BankRule interface (line 73)

**Before:**
```typescript
interface BankRule {
  id: string;
  companyId: string;
  name: string;
  conditionType: string;
  conditionValue: string;
  transactionDirection: string;
  glAccountId: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  glAccount: GlAccount;
  _matchCount: number;
}
```

**After:**
```typescript
interface BankRule {
  id: string;
  companyId: string;
  name: string;
  conditionType: string;
  conditionValue: string;
  transactionDirection: string;
  glAccountId: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  glAccount: GlAccount;
  _matchCount: number;
  // V2 fields (additive, no V1 removal)
  conditions: { field: string; operator: string; value: string }[];
  debitGlAccountId: string | null;
  creditGlAccountId: string | null;
}
```

#### RuleForm interface (line 89)

**Before:**
```typescript
interface RuleForm {
  name: string;
  conditionType: string;
  conditionValue: string;
  transactionDirection: string;
  glAccountId: string | null;
  priority: number;
  isActive: boolean;
}
```

**After:**
```typescript
interface RuleForm {
  name: string;
  conditionType: string;
  conditionValue: string;
  transactionDirection: string;
  glAccountId: string | null;
  priority: number;
  isActive: boolean;
  // V2 fields (additive)
  conditions: { field: string; operator: string; value: string }[];
  debitGlAccountId: string | null;
  creditGlAccountId: string | null;
}
```

#### defaultForm (line 99)

Add to object:
```typescript
conditions: [],
debitGlAccountId: null,
creditGlAccountId: null,
```

#### handleSave compatibility

The `handleSave` function (lines 341–378) already constructs the V2 payload from V1 form fields:

```typescript
const conditions = [{ field: 'description', operator: form.conditionType, value: form.conditionValue.trim() }];
const debitGlAccountId =
  form.transactionDirection === 'debit' || form.transactionDirection === 'any' ? form.glAccountId : null;
const creditGlAccountId =
  form.transactionDirection === 'credit' || form.transactionDirection === 'any' ? form.glAccountId : null;
```

**No behavior change needed** — the payload construction is already correct. The V2 type fields are purely for type-safety at the component level.

**Key decision:** The `conditions` field initializes from `form.conditionType` and `form.conditionValue` as a single-element array of `{ field: 'description', operator, value }`. The form does NOT render a multi-condition UI — this is additive typing only.

---

### 1.2 entity-context-crud-service.ts Fix

**File:** `src/lib/services/entity-context-crud-service.ts`

#### Cast 1 — Line 17: `where` parameter

**Before:**
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const where: any = { companyId };
```

**After:**
```typescript
import { Prisma } from '@prisma/client';
// ...
const where: Prisma.EntityContextWhereInput = { companyId };
```

The dynamic properties added later (`where.pattern`, `where.role`) are structurally compatible with `Prisma.EntityContextWhereInput` — Prisma's `where` type accepts string filters with optional `contains`, `mode`, etc.

#### Cast 2 — Line 43: `data` return

**Before:**
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
data: data as any,
```

**After:**
```typescript
data: data,
```

**Why this compiles:** The function return type is `Promise<PaginatedResult<EntityContextWithGlAccount>>`. `Prisma.findMany({ include: { glAccount: true } })` returns `(EntityContext & { glAccount: GlAccount | null })[]`. Since `EntityContextWithGlAccount` extends `EntityContext` and narrows `glAccount` to `{ id, code, name } | null`, and TypeScript is structurally typed, the wider `GlAccount` type is implicitly assignable to the narrower `{ id, code, name }` — extra fields are ignored in the assignment.

If TS still complains about the structural mismatch (e.g., if `EntityContextWithGlAccount` uses a different shape for `glAccount` than what Prisma infers), add an explicit return type assertion on the function rather than the data:

```typescript
// Only if compiler needs help — prefer the bare `data` first
const result = await db.entityContext.findMany({ ... });
return {
  data: result satisfies EntityContextWithGlAccount[],
  pagination: { ... }
};
```

#### Imports needed

Add to the top of the file:
```typescript
import { Prisma } from '@prisma/client';
```

---

### 1.3 Test Design

**File:** `tests/components/BankRulesPage.test.tsx` (existing, 156 lines)

#### Existing test structure

- 5 tests exist: renders page, displays rule details, renders action buttons, empty state, loading skeleton
- Uses `vi.stubGlobal('fetch', mockFetch)` with a `setupFetchSuccess()` helper
- Mocks: `language-store`, `auth-store`, `sonner`, `AccountSelector`, `EntityOnboardingModal`, `AIRulesGeneratorTab`
- Mock rules (`mockRules`) do NOT include V2 fields — these must be added

#### Test additions (TDD — write BEFORE type changes)

**Test A — V2 payload shape on create:**
```typescript
it('sends V2 fields (conditions, debitGlAccountId, creditGlAccountId) on create', async () => {
  setupFetchSuccess();
  render(<BankRulesPage />);

  await waitFor(() => expect(screen.getByText('bankRules.newRule')).toBeInTheDocument());

  // Click "New Rule" button
  await user.click(screen.getByText('bankRules.newRule'));

  // Fill required fields
  const nameInput = screen.getByLabelText('bankRules.name') || screen.getByRole('textbox', { name: /name/i });
  await user.clear(nameInput);
  await user.type(nameInput, 'Test Rule');

  // Select GL account (AccountSelector mock triggers onChange)
  const accountSelect = screen.getByTestId('account-selector');
  await user.selectOptions(accountSelect, 'acc-1');

  // Submit
  const saveButton = screen.getByText('bankRules.save');
  await user.click(saveButton);

  await waitFor(() => {
    // Find the POST fetch call
    const postCall = mockFetch.mock.calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url === '/api/bank-rules' && opts.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body as string);

    // Assert V2 shape
    expect(body).toHaveProperty('conditions');
    expect(Array.isArray(body.conditions)).toBe(true);
    expect(body.conditions[0]).toEqual({
      field: 'description',
      operator: 'contains',  // default conditionType
      value: 'Test Rule',
    });

    expect(body).toHaveProperty('debitGlAccountId', 'acc-1');
    expect(body).toHaveProperty('creditGlAccountId', 'acc-1');
  });
});
```

**Test B — Direction mapping: debit:**
```typescript
it('maps debit direction correctly to debitGlAccountId', async () => {
  // Similar setup, but change transactionDirection to 'debit' before save
  // Then assert: debitGlAccountId === selected account, creditGlAccountId === null
});
```

**Test C — Direction mapping: credit:**
```typescript
it('maps credit direction correctly to creditGlAccountId', async () => {
  // transactionDirection = 'credit'
  // Assert: creditGlAccountId === selected account, debitGlAccountId === null
});
```

**Test D — Direction mapping: any:**
```typescript
it('maps "any" direction to both debitGlAccountId and creditGlAccountId', async () => {
  // transactionDirection = 'any' (default)
  // Assert: both debitGlAccountId and creditGlAccountId === selected account
});
```

#### Mock data updates

Add V2 fields to mock bank rules returned by fetch:
```typescript
const mockRules = [
  {
    // ... existing fields ...
    conditions: [{ field: 'description', operator: 'contains', value: 'WALMART' }],
    debitGlAccountId: 'acc-1',
    creditGlAccountId: null,
  },
  {
    // ... existing fields ...
    conditions: [{ field: 'description', operator: 'contains', value: 'UBER' }],
    debitGlAccountId: 'acc-2',
    creditGlAccountId: null,
  },
];
```

#### Conditions validation tests (R1.5)

These tests validate API route-level behavior for `POST /api/bank-rules`. They belong in an API route test, NOT the component test:

```
tests/api/bank-rules/validation.test.ts  (new file)
```

Test cases:
1. Empty `conditions` array → 200 accepted
2. Valid operator (`contains`, `equals`, `startsWith`, `regex`) → 200
3. Invalid operator → 400
4. Empty `value` after trim → 400
5. Multiple conditions → 200 accepted

---

## Phase 2: Smart-Classify Integration

### 2.1 Endpoint Compatibility

#### classify-entity GET response shape

```typescript
// GET /api/learning/classify-entity?companyId=X
{
  success: true,
  data: EntityCandidate[]    // from getEntityCandidates()
}
```

#### smart-classify GET response shape

```typescript
// GET /api/learning/smart-classify?companyId=X
{
  data: EntityCandidate[]   // from clusterByBehavior()
}
```

#### EntityCandidate interface comparison

| Field | Local (EntityOnboardingModal) | clusterByBehavior return |
|-------|-------------------------------|--------------------------|
| `id` | `string` | `string` ✅ |
| `canonicalName` | `string` | `string` ✅ |
| `occurrences` | `number` | `number` ✅ |
| `directionProfile.creditPct` | `number` | `number` ✅ |
| `directionProfile.debitPct` | `number` | `number` ✅ |
| `sampleDescriptions` | `string[]` | `string[]` ✅ |
| Extra fields | — | `totalAmount`, `hasContext`, `contextRole`, `suggestedAccountCode`, `suggestedAccountId`, `confidence`, `confidenceLabel`, `explanation`, `direction`, `amountCluster`, `frequency`, `avgAmount` |

The local `EntityCandidate` is a subset of the richer return type. TypeScript structural typing ignores unknown extra fields — **no transformation needed**.

#### Response wrapper difference

- **classify-entity GET**: `{ success: true, data: [...] }`
- **smart-classify GET**: `{ data: [...] }` (no `success` field)

The consumer reads `data.data` in both cases — the `success` field is irrelevant to the consumer. **No consumer code change needed.**

#### Migration change (line 159)

```typescript
// Before:
`/api/learning/classify-entity?companyId=${companyId}`

// After:
`/api/learning/smart-classify?companyId=${companyId}`
```

---

### 2.2 Migration Safety

#### Why only GET changes

The `EntityOnboardingModal` makes 6 total fetch calls to `classify-entity`:

| Line | Method | Purpose | Change in Phase 2? |
|------|--------|---------|--------------------|
| 159 | GET | Fetch candidates | ✅ Switch to `smart-classify` |
| 230 | POST | Auto-save split entity (batch) | ❌ Stay on `classify-entity` |
| 251 | POST | Auto-save entity (batch) | ❌ Stay |
| 570 | POST | Save OTRO entity | ❌ Stay |
| 602 | POST | Save split entity | ❌ Stay |
| 630 | POST | Save normal entity | ❌ Stay |

The POST endpoint (`classify-entity`) is the proven write path that creates `EntityContext` records with role validation, audit logging, and conversational context fallback. The GET endpoint (`smart-classify`) is a read-only improvement using `clusterByBehavior()` for better candidate clustering.

**Separation of concerns:** Reads benefit from improved clustering; writes stay on the proven path.

#### Rollback strategy

Revert line 159 URL string back to `classify-entity`. The old endpoint was never removed, so the modal immediately works with previous behavior. No data migration needed.

---

### 2.3 Endpoint Documentation

**New file:** `docs/endpoints.md`

```
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
```

---

## Phase 3: Wizard Cleanup

### 3.1 Import Audit Procedure

Before any deletion, run these searches:

```bash
# Search for wizard component barrel imports
rg "@/components/wizard" --type ts --type tsx

# Search for wizard store imports
rg "wizard-store" --type ts --type tsx

# Search for wizard service imports
rg "wizard-service" --type ts --type tsx
```

**Expected:** Zero external imports (only self-references within wizard directory).

**If unexpected imports are found:** The importing file must be refactored or the import removed before proceeding with deletion.

### 3.2 Deletion Order

Delete in dependency order to avoid cascading errors if a rollback is needed mid-cleanup:

1. **Test files** (no production dependency):
   - `tests/components/WizardDialog.test.tsx`
   - `tests/components/WizardStep1.test.tsx`
   - `tests/components/WizardStep2.test.tsx`
   - `tests/components/WizardStep3.test.tsx`
   - `tests/components/WizardEmptyState.test.tsx`
   - `tests/stores/wizard-store.test.ts`
   - `tests/services/wizard-service.test.ts`
   - `tests/integration/wizard-full-flow.test.tsx`

2. **Service + store** (no component depends on them via barrel):
   - `src/lib/services/wizard-service.ts`
   - `src/lib/stores/wizard-store.ts`

3. **Components + barrel** (no imports remain):
   - `src/components/wizard/WizardDialog.tsx`
   - `src/components/wizard/WizardStep1.tsx`
   - `src/components/wizard/WizardStep2.tsx`
   - `src/components/wizard/WizardStep3.tsx`
   - `src/components/wizard/WizardEmptyState.tsx`
   - `src/components/wizard/index.ts`

4. **Empty directory** (git won't track empty dirs, but clean up):
   - `src/components/wizard/` (directory removed by git after last file)

---

## Architecture Decisions

### AD-1: Additive V2 types, no V1 field removal

**Decision:** Keep `conditionType`, `conditionValue`, `glAccountId` alongside new V2 fields. Do not mark as deprecated in this change.

**Rationale:** The backend accepts both V1 and V2 shapes. Removing V1 from the frontend types would require auditing all consumers (edit form, display helpers, API payload construction) — scope creep for this change. The form UI (`conditionType` select, `conditionValue` input) is unchanged, so keeping V1 types prevents type errors in form state management.

**Tradeoff:** Slightly larger interface, but zero risk of breaking existing form logic.

### AD-2: No `success` wrapper check for smart-classify

**Decision:** Do not add a `success` property to the smart-classify response or check for it in the consumer.

**Rationale:** The `EntityOnboardingModal` already reads `data.data ?? []` — the `success` field is irrelevant. Adding it would be unnecessary work for an endpoint that only needs to return data. The error path (`!candidatesRes.ok`) already handles HTTP-level failures.

**Tradeoff:** The two endpoints have slightly different response shapes (one has `success`, one doesn't). But since the consumer doesn't read `success`, this is a non-issue.

### AD-3: API route tests for conditions validation, not integration tests

**Decision:** Write conditions validation tests as API route unit tests (mocking Prisma), not as full integration tests with a test database.

**Rationale:** The tests validate request validation logic (schema checks, field requirements), not database behavior. Mocking Prisma is simpler, faster, and already the pattern used in `tests/api/learning/smart-classify.test.ts`.

### AD-4: Wizard cleanup depends on Phase 2 verification

**Decision:** Phase 3 MUST NOT proceed until Phase 2 is verified working in staging or production.

**Rationale:** The wizard code serves as a fallback/alternative flow. If `smart-classify` has issues, users can still fall back to the wizard. Deleting it early would burn the bridge. Phase 3 is the final cleanup after the migration is confirmed stable.

---

## Test Strategy

### Per-phase test plan

| Phase | Existing Tests | New Tests | Test Runner |
|-------|---------------|-----------|-------------|
| **1** | 5 (BankRulesPage) | 4 (V2 payload, 3 direction mapping) + 5 (conditions validation) | Vitest |
| **2** | 7 (smart-classify API) | 0 (no behavior change to test — URL change only; covered by existing tests) | Vitest |
| **3** | 8 (wizard tests) | 0 | Delete wizard tests |

### Phase 1 test matrix (component tests)

| Test | Mock Setup | Assertion Target |
|------|-----------|-----------------|
| V2 shape on create | Default form, select account, submit | POST body has `conditions[]`, `debitGlAccountId`, `creditGlAccountId` |
| debit direction | Set direction='debit' before submit | `debitGlAccountId = acc-1`, `creditGlAccountId = null` |
| credit direction | Set direction='credit' before submit | `creditGlAccountId = acc-1`, `debitGlAccountId = null` |
| any direction | Default (direction='any') | Both `debitGlAccountId` and `creditGlAccountId = acc-1` |

### Phase 2 test strategy

The GET URL change (line 159) is a one-line string swap. It does not change the data flow logic — the response is still parsed as `data.data ?? []`. Existing tests in `tests/api/learning/smart-classify.test.ts` already verify the smart-classify response shape. **No new tests needed for Phase 2.**

### Phase 3 test strategy

Delete wizard test files. Verify all remaining tests pass:
```bash
npx vitest run
```

If remaining tests reference deleted wizard code, the import audit missed something — fix before proceeding.

---

## Delivery

Three PRs on the `feat/entities-bank-rules` tracker branch, each merging independently to `main`:

| PR | Phase | Estimated Lines | Risk |
|----|-------|----------------|------|
| #1 | Type fixes + tests | ~120 (types: 10, tests: 110) | Low |
| #2 | Smart-classify integration | ~30 (1 line change + docs) | Low |
| #3 | Wizard cleanup | ~0 (deletions only) | Low |

Each PR within the 400-line review budget. Phase 3 conditional on Phase 2 verification.

<!-- Engram: topic_key sdd/entities-bank-rules/design -->
