# Tasks: entities-bank-rules

## Delivery Configuration

| Setting | Value |
|---------|-------|
| Strategy | Chained PRs (force-chained) |
| Chain strategy | feature-branch-chain |
| Tracker branch | `feat/entities-bank-rules` |
| Review budget | 400 lines max per PR |
| Work-unit commits | Each task = clean, reviewable commit |
| TDD Mode | Strict — write tests before implementation |

### Branch Setup

Before any task work, create the tracker branch:
```bash
git checkout -b feat/entities-bank-rules main
git push origin feat/entities-bank-rules
```

Each PR targets the tracker branch:
- PR #1 → `feat/entities-bank-rules`
- PR #2 → branch of PR #1
- PR #3 → branch of PR #2

---

## Phase 1: Type Fixes & Tests — PR #1

**Target branch:** `feat/entities-bank-rules`
**Estimated size:** ~120 lines (types: 10, tests: 90, validation: 15)
**Commit prefix:** `phase1/`

### Verification Cycle (runs after each task in this phase)

```bash
# After each RED test commit:
npx vitest run --reporter=verbose 2>&1 | head -40

# After each GREEN implementation commit:
npx vitest run --reporter=verbose 2>&1 | head -40
npx tsc --noEmit 2>&1 | head -20
```

---

### Task 1.1 — Add V2 fields to BankRule interface
**Type:** RED → GREEN → REFACTOR
**File:** `src/components/spa/BankRulesPage.tsx`
**Test coverage:** Verified by `tsc --noEmit` and existing BankRulesPage tests

**RED:** Verify that `tsc --noEmit` currently passes (baseline).

**GREEN:** Add three fields to the `BankRule` interface at lines 73-87, preserving all V1 fields:

```typescript
interface BankRule {
  // ...existing V1 fields (conditionType, conditionValue, glAccountId, etc.)
  // V2 fields (additive, no V1 removal)
  conditions: { field: string; operator: string; value: string }[];
  debitGlAccountId: string | null;
  creditGlAccountId: string | null;
}
```

**REFACTOR:** Run `npx vitest run` to verify existing tests still pass.

**Commit:** `phase1/1.1: add V2 fields to BankRule interface`

---

### Task 1.2 — Add V2 fields to RuleForm interface and defaultForm
**Type:** RED → GREEN → REFACTOR
**File:** `src/components/spa/BankRulesPage.tsx`

**RED:** Confirm the form compiles without V2 fields (baseline).

**GREEN:**
1. Add to `RuleForm` interface (lines 89-97):
   ```typescript
   conditions: { field: string; operator: string; value: string }[];
   debitGlAccountId: string | null;
   creditGlAccountId: string | null;
   ```
2. Add to `defaultForm` (line 99):
   ```typescript
   conditions: [],
   debitGlAccountId: null,
   creditGlAccountId: null,
   ```

**REFACTOR:** Run `npx tsc --noEmit` — must pass with 0 errors.

**Commit:** `phase1/1.2: add V2 fields to RuleForm and defaultForm`

---

### Task 1.3 — Replace `as any` at line 17 in entity-context-crud-service.ts
**Type:** RED → GREEN → REFACTOR
**File:** `src/lib/services/entity-context-crud-service.ts`

**RED:** Line 17 currently reads `const where: any = { companyId }`. Confirm the `eslint-disable-next-line` comment exists at line 16.

**GREEN:**
1. Add import at top: `import { Prisma } from '@prisma/client';`
2. Replace lines 16-17:
   ```typescript
   const where: Prisma.EntityContextWhereInput = { companyId };
   ```
   Remove the `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment.

**REFACTOR:** Run `npx tsc --noEmit` — must pass. Run `npx vitest run` — existing tests must pass.

**Commit:** `phase1/1.3: replace as any with Prisma.EntityContextWhereInput`

---

### Task 1.4 — Remove `as any` cast at line 43 in entity-context-crud-service.ts
**Type:** RED → GREEN → REFACTOR
**File:** `src/lib/services/entity-context-crud-service.ts`

**RED:** Line 42-43 currently reads:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
data: data as any,
```

**GREEN:**
1. Remove the eslint-disable comment and `as any`:
   ```typescript
   data: data,
   ```
2. Run `npx tsc --noEmit` — structural typing should handle this because `EntityContextWithGlAccount` narrows `glAccount` to `{ id, code, name } | null`, and the wider `GlAccount` from Prisma is structurally compatible (extra fields are ignored).
3. **If TS complains:** add `satisfies EntityContextWithGlAccount[]` to the `data` result from `findMany` instead.

**REFACTOR:** Run `npx vitest run` — existing tests must pass.

**Commit:** `phase1/1.4: remove as any cast from listEntityContexts return`

---

### Task 1.5 — Update mock rules with V2 fields
**Type:** RED → GREEN → REFACTOR
**File:** `tests/components/BankRulesPage.test.tsx`

**RED:** The mock rules at lines 48-79 have no V2 fields. Write test expectations before updating the mock data.

**GREEN:** Add V2 fields to both mock rule objects:
```typescript
// For mockRules[0] (Walmart):
conditions: [{ field: 'description', operator: 'contains', value: 'WALMART' }],
debitGlAccountId: 'acc-1',
creditGlAccountId: null,

// For mockRules[1] (Uber):
conditions: [{ field: 'description', operator: 'contains', value: 'UBER' }],
debitGlAccountId: 'acc-2',
creditGlAccountId: null,
```

**REFACTOR:** Run `npx vitest run` — all 5 existing tests must still pass.

**Commit:** `phase1/1.5: add V2 fields to test mock rules`

---

### Task 1.6 — Write V2 payload shape test (Test A)
**Type:** RED → GREEN → REFACTOR
**File:** `tests/components/BankRulesPage.test.tsx`

**RED:** Add test `'sends V2 fields (conditions, debitGlAccountId, creditGlAccountId) on create'`:
1. Click "New Rule" button
2. Fill name input
3. Select GL account via AccountSelector mock
4. Submit
5. Intercept POST fetch call and assert:
   - `body.conditions` is an array with 1 element: `{ field: 'description', operator: 'contains', value: <name> }`
   - `body.debitGlAccountId` equals the selected account
   - `body.creditGlAccountId` equals the selected account

The test will fail initially because the test infrastructure needs setup.

**GREEN:** Ensure test infrastructure supports it:
- `setupFetchSuccess()` already intercepts POST calls
- The mock `AccountSelector` renders a `<select>` — use `screen.getByTestId('account-selector')` and fire `change` event
- Use `screen.getByText('bankRules.newRule')` for button clicks

**REFACTOR:** Run `npx vitest run --reporter=verbose` — test must pass.

**Commit:** `phase1/1.6: test V2 payload shape on create`

---

### Task 1.7 — Write direction mapping tests (Tests B, C, D)
**Type:** RED → GREEN → REFACTOR
**File:** `tests/components/BankRulesPage.test.tsx`

**RED:** Add three direction mapping tests:

**Test B — debit direction:**
- Set `transactionDirection` to 'debit' before submit
- Assert: `debitGlAccountId` equals selected account, `creditGlAccountId` is null

**Test C — credit direction:**
- Set `transactionDirection` to 'credit' before submit
- Assert: `creditGlAccountId` equals selected account, `debitGlAccountId` is null

**Test D — any direction:**
- Default `transactionDirection` is 'any'
- Assert: both `debitGlAccountId` and `creditGlAccountId` equal the selected account

**GREEN:** Select the direction dropdown (`Select` component) before submitting. Use the `Select` trigger and `onValueChange` pattern — or set the form state direction via `screen.getByRole('combobox', ...)` and fire value change.

**REFACTOR:** Run `npx vitest run --reporter=verbose` — all 3 tests must pass.

**Commit:** `phase1/1.7: test direction-to-glAccountId mapping (debit/credit/any)`

---

### Task 1.8 — Write API route conditions[] validation tests
**Type:** RED → GREEN → REFACTOR
**New file:** `tests/api/bank-rules/validation.test.ts`
**Design notes:** See smart-classify test pattern in `tests/api/learning/smart-classify.test.ts` for mocking approach.

**RED:** Create the test file with 5 test cases. Mock Prisma's `db` module and call the POST handler directly:

```typescript
// tests/api/bank-rules/validation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/bank-rules/route';
import { NextRequest } from 'next/server';

// Mock deps (sessions, db, audit, logger, direction-validation)
vi.mock('@/lib/sessions', () => ({
  getSessionUserId: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', role: 'company_admin' }) },
    companyMember: {
      findUnique: vi.fn().mockResolvedValue({ id: 'member-1', userId: 'user-1', companyId: 'company-1' }),
    },
    glAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'acc-1' }]) },
    bankRule: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ /* minimal rule */ }) },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ createAuditLogWithRetry: vi.fn() }));
vi.mock('@/lib/services/direction-validation', () => ({
  validateDirectionProfile: vi.fn().mockResolvedValue(undefined),
}));
```

**Test cases:**

1. **Empty `conditions` array → 200 accepted**
   - Body: `{ companyId: 'c1', name: 'Test', conditions: [], transactionDirection: 'any', debitGlAccountId: 'acc-1', creditGlAccountId: 'acc-1' }`
   - **Critical:** The current API route (line 119-125) returns 400 for empty conditions. This test asserts 200 per the spec boundary definition. The implementation MUST change the validation to accept empty arrays (see Implementation Note below).

2. **Valid operator → 200 accepted**
   - Body: `{ companyId: 'c1', name: 'Test', conditions: [{ field: 'description', operator: 'contains', value: 'WALMART' }], transactionDirection: 'any', debitGlAccountId: 'acc-1' }`

3. **Invalid operator → 400**
   - Body: `{ companyId: 'c1', name: 'Test', conditions: [{ field: 'description', operator: 'invalid_op', value: 'test' }], transactionDirection: 'any', debitGlAccountId: 'acc-1' }`
   - Assert: `response.status === 400`, `body.error` contains "condition operator must be one of"

4. **Empty value after trim → 400**
   - Body: `{ companyId: 'c1', name: 'Test', conditions: [{ field: 'description', operator: 'contains', value: '   ' }], transactionDirection: 'any', debitGlAccountId: 'acc-1' }`
   - Assert: `response.status === 400`, `body.error` contains "condition value cannot be empty"

5. **Multiple conditions → 200 accepted**
   - Body: `{ companyId: 'c1', name: 'Test', conditions: [{ field: 'description', operator: 'contains', value: 'WALMART' }, { field: 'description', operator: 'equals', value: 'TARGET' }], transactionDirection: 'any', debitGlAccountId: 'acc-1', creditGlAccountId: 'acc-1' }`

**GREEN (Implementation Note for empty conditions):**
The API route at `src/app/api/bank-rules/route.ts` lines 118-125 currently rejects empty conditions arrays. Change the validation to:
```typescript
if (conditions) {
  if (!Array.isArray(conditions)) {
    return NextResponse.json({ error: 'conditions must be an array' }, { status: 400 });
  }
  // Empty array is accepted (rule acts as a no-op matcher or placeholder)
  if (conditions.length > 0) {
    for (const cond of conditions) {
      // ... existing condition validation ...
    }
  }
} else {
  // ... legacy fallback unchanged ...
}
```

This wraps the per-condition validation inside `if (conditions.length > 0)` so an empty array passes validation without looping.

**REFACTOR:** Run `npx vitest run tests/api/bank-rules/validation.test.ts --reporter=verbose` — all 5 tests must pass.

**Commit:** `phase1/1.8: add conditions[] validation tests for POST /api/bank-rules`

---

### Phase 1 — Verification Checklist

After all Phase 1 tasks are committed:

```bash
npx vitest run --reporter=verbose           # All tests pass
npx tsc --noEmit                            # Zero type errors
npx eslint src/components/spa/BankRulesPage.tsx src/lib/services/entity-context-crud-service.ts  # No any
```

---

## Phase 2: Smart-Classify Integration — PR #2

**Target branch:** branch of PR #1 (e.g., `feat/entities-bank-rules-P1`)
**Estimated size:** ~30 lines (1 line change + docs)
**Commit prefix:** `phase2/`

### Task 2.1 — Change GET URL from classify-entity to smart-classify
**Type:** RED → GREEN → REFACTOR
**File:** `src/components/learning/EntityOnboardingModal.tsx`

**RED:** Confirm the current URL at line 159 is `/api/learning/classify-entity?companyId=${companyId}`.

**GREEN:** Change line 159:
```typescript
// Before:
`/api/learning/classify-entity?companyId=${companyId}`

// After:
`/api/learning/smart-classify?companyId=${companyId}`
```

Do NOT change the 5 POST calls at lines 230, 251, 570, 602, 630 — they must continue using `classify-entity` during the migration period.

**REFACTOR:** Run `npx vitest run` — existing tests must pass.

**Commit:** `phase2/2.1: switch EntityOnboardingModal GET to smart-classify`

---

### Task 2.2 — Verify smart-classify response compatibility
**Type:** Verify only (no code change)
**Files:** `src/components/learning/EntityOnboardingModal.tsx`, `src/app/api/learning/smart-classify/route.ts`

**Verification steps:**

1. **Response wrapper check:** `smart-classify` returns `{ data: EntityCandidate[] }` (no `success` field). The consumer reads `data.data ?? []` at line 164. This is compatible because the outer `data` is the response body, and the inner `data` is the array. **No change needed.**

2. **Field compatibility:** The `EntityCandidate` interface in `EntityOnboardingModal.tsx` (lines 35-44) is a subset of the richer return type from `clusterByBehavior()`. TypeScript structural typing ignores unknown extra fields. **No transformation needed.**

3. **Error handling:** Both endpoints use HTTP status codes for errors. The consumer checks `candidatesRes.ok` at line 162. **No change needed.**

**Document findings** in the commit message or as a code comment if non-obvious.

**Commit:** `phase2/2.2: verify smart-classify response compatibility with EntityCandidate`

---

### Task 2.3 — Create endpoint purpose documentation
**Type:** Write only
**New file:** `docs/endpoints.md`

**Content:** Document the purpose and usage of each related endpoint:

| Endpoint | Purpose | Used by |
|----------|---------|---------|
| `/api/bank-rules` | Pure CRUD for bank rules. No entity context involved. | BankRulesPage, AIAssistantModal |
| `/api/learning/rules` | Atomic rule + entity context creation. Guarantees entity+rule consistency. | EntityOnboardingModal save |
| `/api/learning/classify-entity` | Legacy endpoint. POST ops still active for entity creation during migration. | EntityOnboardingModal POST saves |
| `/api/learning/smart-classify` | Improved candidate listing with behavior-based clustering. Read-only. | EntityOnboardingModal candidate fetch |

Place this in `docs/endpoints.md` (new file). See `openspec/changes/entities-bank-rules/design.md` section 2.3 for exact text to use.

**Commit:** `phase2/2.3: add endpoint purpose documentation`

---

### Phase 2 — Verification Checklist

```bash
npx vitest run --reporter=verbose    # All tests pass (including smart-classify API tests)
# Manual: verify GET /api/learning/smart-classify?companyId=X returns valid data
```

---

## Phase 3: Wizard Cleanup — PR #3

**Target branch:** branch of PR #2 (e.g., `feat/entities-bank-rules-P2`)
**Estimated size:** deletions only (~0 lines added, ~16 files removed)
**Commit prefix:** `phase3/`
**Blocked by:** Phase 2 verified in staging/production

### Task 3.1 — Import audit
**Type:** Verify only (no code change)

Run these searches to confirm no external code references the wizard files:

```bash
# Search for wizard component barrel imports
rg "@/components/wizard" --type-add 'web:*.{ts,tsx}' --type web

# Search for wizard store imports
rg "wizard-store" --type-add 'web:*.{ts,tsx}' --type web

# Search for wizard service imports
rg "wizard-service" --type-add 'web:*.{ts,tsx}' --type web
```

**Expected results:** Zero external imports.
- If any import is found (other than from within `src/components/wizard/` itself), STOP and report. The importing file must be refactored before proceeding.
- If zero imports found, proceed to Task 3.2.

**Commit:** `phase3/3.1: import audit — no external wizard imports found`

---

### Task 3.2 — Delete wizard test files (8 files)
**Type:** Delete only

Delete in this order (no dependencies between test files):

```bash
git rm tests/components/WizardDialog.test.tsx
git rm tests/components/WizardStep1.test.tsx
git rm tests/components/WizardStep2.test.tsx
git rm tests/components/WizardStep3.test.tsx
git rm tests/components/WizardEmptyState.test.tsx
git rm tests/stores/wizard-store.test.ts
git rm tests/services/wizard-service.test.ts
git rm tests/integration/wizard-full-flow.test.tsx
```

**Verify:** `npx vitest run` — must still pass (excludes deleted test files).

**Commit:** `phase3/3.2: remove wizard test files`

---

### Task 3.3 — Delete wizard service and store (2 files)
**Type:** Delete only

```bash
git rm src/lib/services/wizard-service.ts
git rm src/lib/stores/wizard-store.ts
```

**Verify:** `npx vitest run` — must still pass.
**Verify:** `npx tsc --noEmit` — must pass.

**Commit:** `phase3/3.3: remove wizard service and store`

---

### Task 3.4 — Delete wizard components and barrel (6 files)
**Type:** Delete only

```bash
git rm src/components/wizard/WizardDialog.tsx
git rm src/components/wizard/WizardStep1.tsx
git rm src/components/wizard/WizardStep2.tsx
git rm src/components/wizard/WizardStep3.tsx
git rm src/components/wizard/WizardEmptyState.tsx
git rm src/components/wizard/index.ts
```

After deletion, the `src/components/wizard/` directory should be empty. Git will untrack the empty directory.

**Verify:** `npx vitest run` — must still pass.
**Verify:** `npx tsc --noEmit` — must pass.
**Verify:** `git diff --stat` confirms all wizard files removed.

**Commit:** `phase3/3.4: remove wizard components`

---

### Task 3.5 — Final smoke test
**Type:** Verify only

```bash
# Full test suite
npx vitest run --reporter=verbose

# Type check
npx tsc --noEmit

# Confirm no wizard code remains
rg "wizard" --type-add 'web:*.{ts,tsx}' --type web | head -20
# Expected: zero matches (or only changelogs/docs)
```

**Commit:** `phase3/3.5: final smoke test — all tests pass, no wizard code remains`

---

### Phase 3 — Verification Checklist

```bash
npx vitest run                        # All remaining tests pass
npx tsc --noEmit                      # Zero type errors
git diff --stat --diff-filter=D HEAD  # Confirms all wizard files deleted
```

---

## Test File Inventory

| Test File | Tasks Covered | Type |
|-----------|--------------|------|
| `tests/components/BankRulesPage.test.tsx` | 1.5, 1.6, 1.7 | Component (Vitest + jsdom) |
| `tests/api/bank-rules/validation.test.ts` | 1.8 | API Route (Vitest, mocked Prisma) |
| `tests/api/learning/smart-classify.test.ts` | 2.2 (verify only) | API Route (Vitest, mocked Prisma) |

---

## Review Workload Forecast

| Phase | Estimated Lines | Review Budget | Status |
|-------|----------------|---------------|--------|
| Phase 1: Type Fixes & Tests | ~120 | 400 lines ✅ | Within budget |
| Phase 2: Smart-Classify Integration | ~30 | 400 lines ✅ | Within budget |
| Phase 3: Wizard Cleanup | ~0 (deletions only) | 400 lines ✅ | Negative lines |

**Chained PRs recommended:** Yes — each phase is an independent, reviewable unit.
**400-line budget risk:** Low — individual phases are well under 400 lines.
**Decision needed before apply:** No — all decisions documented in spec + design.

---

## Dependencies Between Tasks

```
Phase 1 (tasks 1.1-1.8) ──independent──▶ Phase 2 (tasks 2.1-2.3)
                                                    │
                                                    │ requires Phase 2 verified in staging/prod
                                                    ▼
                                           Phase 3 (tasks 3.1-3.5)
```

- Phase 1 tasks are independent of each other within the phase, but should be applied as a single PR.
- Phase 2 has no code dependency on Phase 1 (different files), but they ship in sequence for PR clarity.
- Phase 3 MUST NOT start until Phase 2 is verified working in staging/production.
