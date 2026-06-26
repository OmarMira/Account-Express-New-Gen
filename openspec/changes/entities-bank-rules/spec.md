# Spec: entities-bank-rules

## Phase 1 — Type Fixes & Tests (No Behavior Change)

### Requirements

#### R1.1: BankRule interface MUST include V2 fields

The local `BankRule` interface in `BankRulesPage.tsx` (lines 73-87) MUST add three fields that `handleSave()` already constructs and sends to the API but the type does not reflect:

- `conditions: { field: string; operator: string; value: string }[]`
- `debitGlAccountId: string | null`
- `creditGlAccountId: string | null`

The existing fields (`conditionType`, `conditionValue`, `glAccountId`) MUST be preserved for backward compatibility — the V2 fields are additive.

#### R1.2: RuleForm interface MUST include V2 fields

The local `RuleForm` interface in `BankRulesPage.tsx` (lines 89-97) MUST add the same three V2 fields with the same types as R1.1. `defaultForm` MUST initialize them:

- `conditions: []` (empty array)
- `debitGlAccountId: null`
- `creditGlAccountId: null`

#### R1.3: Remove `as any` casts from entity-context-crud-service.ts

Two casts in `src/lib/services/entity-context-crud-service.ts` MUST be replaced with proper Prisma types:

- **Line 17**: `const where: any = { companyId }` → `const where: Prisma.EntityContextWhereInput = { companyId }`
- **Line 43**: `data: data as any` → the return type already matches `PaginatedResult<EntityContextWithGlAccount>`, so the cast is unnecessary. Remove the `as any` and add an explicit return type annotation to the function if the compiler requires it.

#### R1.4: Test handleSave() V2 payload shape

Add tests in `tests/components/BankRulesPage.test.tsx` that:

- Open the create rule modal, fill required fields, submit, and intercept the `fetch()` call to assert the JSON body contains `conditions`, `debitGlAccountId`, and `creditGlAccountId`
- Verify that when `transactionDirection === 'debit'`, `debitGlAccountId` equals the selected GL account and `creditGlAccountId` is `null`
- Verify that when `transactionDirection === 'credit'`, `creditGlAccountId` equals the selected GL account and `debitGlAccountId` is `null`
- Verify that when `transactionDirection === 'any'`, both `debitGlAccountId` and `creditGlAccountId` equal the selected GL account
- Verify the `conditions` array shape: `[{ field: 'description', operator: form.conditionType, value: form.conditionValue.trim() }]`

#### R1.5: Test conditions[] validation edge cases for POST /api/bank-rules

Add tests (backend or integration-level) that verify:

- A rule with an empty `conditions` array is accepted (the frontend always sends one condition, but the API should handle empty)
- A condition with a valid `operator` (`contains`, `equals`, `startsWith`, `regex`) is accepted
- A condition with an invalid `operator` is rejected with 400
- A condition with an empty `value` after trim is rejected with 400
- Multiple conditions in the array are accepted (future-proofing)

These tests MUST pass regardless of the backend implementation — they define boundary behavior.

### Acceptance Criteria

- [ ] AC1.1: `BankRule` interface includes `conditions`, `debitGlAccountId`, `creditGlAccountId` as specified
- [ ] AC1.2: `RuleForm` interface includes V2 fields; `defaultForm` initializes them
- [ ] AC1.3: Zero `as any` casts remain in `entity-context-crud-service.ts`
- [ ] AC1.4: V2 payload test asserts `conditions`, `debitGlAccountId`, `creditGlAccountId` in the fetch body
- [ ] AC1.5: Direction mapping test asserts correct null/assigned values per direction
- [ ] AC1.6: Conditions validation tests pass for empty, valid, invalid operators, and empty value
- [ ] AC1.7: All existing tests still pass

### Files to Change

- `src/components/spa/BankRulesPage.tsx` — Add V2 fields to `BankRule` (line 73), `RuleForm` (line 89), and `defaultForm` (line 99)
- `src/lib/services/entity-context-crud-service.ts` — Replace `as any` at lines 17 and 43 with proper Prisma types
- `tests/components/BankRulesPage.test.tsx` — Add V2 payload shape tests and direction mapping tests
- `tests/**/*.test.{ts,tsx}` — Add conditions validation tests (scope TBD: backend integration or API route test)

---

## Phase 2 — Smart-Classify Integration

### Requirements

#### R2.1: EntityOnboardingModal fetches candidates from smart-classify

The `fetchData()` function in `EntityOnboardingModal.tsx` MUST switch from `/api/learning/classify-entity?companyId=${companyId}` to `/api/learning/smart-classify?companyId=${companyId}` for the initial GET request (line 159).

The response shape MUST be backward-compatible with the existing `EntityCandidate` interface:

```typescript
interface EntityCandidate {
  id: string;
  canonicalName: string;
  occurrences: number;
  directionProfile: {
    creditPct: number;
    debitPct: number;
  };
  sampleDescriptions: string[];
}
```

If the new endpoint returns additional fields, the code MUST ignore unknown fields (no breaking change to the consumer).

#### R2.2: All POST calls keep using classify-entity

The 5 remaining POST calls to `/api/learning/classify-entity` (lines 230, 251, 570, 602, 630) MUST continue using the old endpoint during the migration period. Only the GET candidate-fetch endpoint changes in this phase.

This ensures that entity creation/classification writes go through the proven path while reads benefit from the improved smart-classify logic.

#### R2.3: Document endpoint purpose

Create/update an inline documentation section (either as a code comment block or a short `docs/` snippet) that clarifies:

| Endpoint | Purpose | When to use |
|----------|---------|-------------|
| `/api/bank-rules` | Pure CRUD for bank rules. GET list, POST create, PUT update, DELETE. No entity context involved. | BankRulesPage CRUD operations. AIAssistantModal rule creation. |
| `/api/learning/rules` | Atomic rule + entity context creation. Creates both the bank rule and the associated EntityContext in one transaction. | EntityOnboardingModal save operations. Any flow that needs to guarantee entity+rule consistency. |
| `/api/learning/classify-entity` | Legacy entity classification endpoint. Kept alive during migration. | Entity creation during Phase 2 migration period. |
| `/api/learning/smart-classify` | Improved candidate listing with smart classification logic. | EntityOnboardingModal candidate fetch. |

Place this documentation in a well-known location, e.g., `docs/endpoints.md` or as a comment in a barrel file.

#### R2.4: Keep old classify-entity endpoint alive

The `/api/learning/classify-entity` endpoint MUST NOT be removed or modified during Phase 2. It continues to serve POST requests for entity creation until Phase 3 cleanup.

### Acceptance Criteria

- [ ] AC2.1: `EntityOnboardingModal` GET candidate fetch uses `/api/learning/smart-classify`
- [ ] AC2.2: All 5 POST calls in `EntityOnboardingModal` still use `/api/learning/classify-entity`
- [ ] AC2.3: Response shape from `smart-classify` is compatible with `EntityCandidate` (no consumer breakage)
- [ ] AC2.4: Endpoint documentation exists and clearly distinguishes `/api/bank-rules` vs `/api/learning/rules` vs `/api/learning/smart-classify`
- [ ] AC2.5: Old `classify-entity` endpoint still responds correctly to POST requests
- [ ] AC2.6: All existing tests pass

### Files to Change

- `src/components/learning/EntityOnboardingModal.tsx` — Change line 159 from `classify-entity` to `smart-classify`; leave lines 230, 251, 570, 602, 630 unchanged
- `docs/endpoints.md` or equivalent — Add endpoint purpose documentation
- No API route changes (old endpoint lives on)

---

## Phase 3 — Wizard Dead Code Cleanup

### Requirements

#### R3.1: Remove all wizard component files

Delete the following files after confirming nothing imports them:

- `src/components/wizard/WizardDialog.tsx`
- `src/components/wizard/WizardStep1.tsx`
- `src/components/wizard/WizardStep2.tsx`
- `src/components/wizard/WizardStep3.tsx`
- `src/components/wizard/WizardEmptyState.tsx`
- `src/components/wizard/index.ts`

#### R3.2: Remove wizard store

- `src/lib/stores/wizard-store.ts` — Delete after confirming no remaining imports

#### R3.3: Remove wizard service

- `src/lib/services/wizard-service.ts` — Delete after confirming no remaining imports

#### R3.4: Remove wizard test files

Delete the following test files that test deleted code:

- `tests/components/WizardDialog.test.tsx`
- `tests/components/WizardStep1.test.tsx`
- `tests/components/WizardStep2.test.tsx`
- `tests/components/WizardStep3.test.tsx`
- `tests/components/WizardEmptyState.test.tsx`
- `tests/stores/wizard-store.test.ts`
- `tests/services/wizard-service.test.ts`
- `tests/integration/wizard-full-flow.test.tsx`

#### R3.5: Import audit before deletion

BEFORE deleting any file, run a full-repo search for imports from:

- `@/components/wizard`
- `@/lib/stores/wizard-store`
- `@/lib/services/wizard-service`

If any import is found (other than the files being deleted themselves), that import MUST be removed or the component refactored before proceeding. If no imports are found (expected), proceed with deletion.

#### R3.6: Verify EntityOnboardingModal flow after cleanup

After wizard removal, a manual or automated smoke test MUST verify that:

1. EntityOnboardingModal opens and fetches candidates via `smart-classify` (Phase 2 change)
2. Role assignment and save still works
3. BankRulesPage rule creation flow is unaffected

### Acceptance Criteria

- [ ] AC3.1: `src/components/wizard/` directory no longer exists
- [ ] AC3.2: `src/lib/stores/wizard-store.ts` no longer exists
- [ ] AC3.3: `src/lib/services/wizard-service.ts` no longer exists
- [ ] AC3.4: All wizard test files are deleted
- [ ] AC3.5: Zero imports reference any deleted wizard file
- [ ] AC3.6: All remaining tests pass (no import resolution failures)
- [ ] AC3.7: EntityOnboardingModal and BankRulesPage work correctly after cleanup

### Files to Remove

- `src/components/wizard/WizardDialog.tsx`
- `src/components/wizard/WizardStep1.tsx`
- `src/components/wizard/WizardStep2.tsx`
- `src/components/wizard/WizardStep3.tsx`
- `src/components/wizard/WizardEmptyState.tsx`
- `src/components/wizard/index.ts`
- `src/lib/stores/wizard-store.ts`
- `src/lib/services/wizard-service.ts`
- `tests/components/WizardDialog.test.tsx`
- `tests/components/WizardStep1.test.tsx`
- `tests/components/WizardStep2.test.tsx`
- `tests/components/WizardStep3.test.tsx`
- `tests/components/WizardEmptyState.test.tsx`
- `tests/stores/wizard-store.test.ts`
- `tests/services/wizard-service.test.ts`
- `tests/integration/wizard-full-flow.test.tsx`

---

## Cross-cutting Concerns

### V1/V2 Field Coexistence

Throughout all phases, the `BankRule` and `RuleForm` interfaces MUST keep both:
- Legacy fields: `conditionType`, `conditionValue`, `glAccountId`
- V2 fields: `conditions`, `debitGlAccountId`, `creditGlAccountId`

The backend MUST accept both shapes. The frontend `handleSave()` already constructs V2 from V1 form fields — this spec only fixes the type gap, not the behavior.

### Dead Code Verification

Phase 3 MUST NOT proceed until Phase 2 is verified working in production or staging. The wizard code serves as a fallback — do not delete it while any user could still be relying on the old flow.

### Test File Co-location

The wizard test files must be deleted as part of the same PR as their source files. Do not leave dangling test files that import deleted code (they will cause test runner failures).

### smart-classify Backend Readiness

The `/api/learning/smart-classify` endpoint MUST exist and return a backward-compatible response BEFORE Phase 2 is deployed. Phase 1 has no dependency on this endpoint and can ship independently.

---

## Migration / Rollback

### Phase 1 Rollback

Type additions are additive — no rollback needed. If the `as any` removal causes unexpected type errors in callers, revert `entity-context-crud-service.ts` to the previous version. Tests can be reverted via `git revert`.

### Phase 2 Rollback

Revert the fetch URL in `EntityOnboardingModal.tsx` line 159 from `smart-classify` back to `classify-entity`. The old endpoint was never removed, so the modal will immediately work again with the previous behavior.

### Phase 3 Rollback

Restore deleted files from git: `git checkout HEAD~1 -- src/components/wizard/ src/lib/stores/wizard-store.ts src/lib/services/wizard-service.ts tests/components/Wizard* tests/stores/wizard-store.test.ts tests/services/wizard-service.test.ts tests/integration/wizard-full-flow.test.tsx`

Because Phase 3 depends on Phase 2 being verified, the rollback of Phase 2 MUST happen first if something goes wrong, and Phase 3 follows.
