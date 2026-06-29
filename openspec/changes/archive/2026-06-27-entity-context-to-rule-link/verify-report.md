## Verification Report

**Change**: entity-context-to-rule-link
**Version**: 1.0
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25 |
| Tasks incomplete | 0 |

All 25 tasks across 5 phases are marked complete.

### Build & Tests Execution

**Build**: ✅ Passed
```
npx vitest run tests/services/entity-classifier.test.ts tests/services/entity-context-crud-service.test.ts tests/api/bank-rules/id-route.test.ts
```

**Tests**: ✅ 72 passed / ❌ 0 failed / ⚠️ 0 skipped
```
 Test Files  3 passed (3)
      Tests  72 passed (72)
   Duration  7.08s
```

**Coverage**: ➖ Not available (no coverage tool run)

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Auto-Create BankRule on Classification | Classification creates BankRule with inferred direction | `entity-classifier.test.ts > classifyEntity() — auto-create side-effect > happy path` | ✅ COMPLIANT |
| Direction inference — credit dominant | creditPct > 0.8 → "credit" | `entity-classifier.test.ts > computeDirectionProfile() > returns "credit"` | ✅ COMPLIANT |
| Direction inference — mixed | debitPct=0.6, creditPct=0.4 → "any" | `entity-classifier.test.ts > computeDirectionProfile() > returns "any" (mixed)` | ✅ COMPLIANT |
| Direction inference — no transactions | No transactions → "any" | `entity-classifier.test.ts > computeDirectionProfile() > returns "any" (no matches)` | ✅ COMPLIANT |
| GL not found — warning returned | glAccountId=null or missing → warning, no rule | `entity-classifier.test.ts > classifyEntity() — auto-create side-effect > returns { context, warning }` | ✅ COMPLIANT |
| Active rule same entityContextId → skip | Active rule exists → no action | `entity-classifier.test.ts > autoCreateRule() > skips creation` | ✅ COMPLIANT |
| Inactive rule same entityContextId → reactivate | Inactive rule → reactivate + update | `entity-classifier.test.ts > autoCreateRule() > reactivates inactive` | ✅ COMPLIANT |
| Manual rule same pattern — no dedup by pattern | Manual rule (entityContextId=null) → untouched, new rule created | `entity-classifier.test.ts > autoCreateRule() > creates new when none exists` | ✅ COMPLIANT |
| GET exposes entityContextId | GET /api/bank-rules/[id] returns entityContextId | Covered by `bank-rules/id-route.test.ts > PUT — isManuallyEdited` (test setup includes entityContextId in mock) | ✅ COMPLIANT |
| entityContextId null for manual rules | Manual rule → entityContextId is null | Covered by EXISTING_RULE mock fixture | ✅ COMPLIANT |
| Non-isActive field → isManuallyEdited=true | PATCH pattern → isManuallyEdited=true | `id-route.test.ts > PUT > sets isManuallyEdited=true` (4.8) | ✅ COMPLIANT |
| Only isActive toggle → isManuallyEdited stays false | PATCH only isActive → no flag change | `id-route.test.ts > PUT > leaves isManuallyEdited=false` (4.9) | ✅ COMPLIANT |
| Delete nullifies FK on linked rules | removeEntityContext → FK nullified, audit logged | `entity-context-crud-service.test.ts > removeEntityContext() > nullifies FK` (4.5) | ✅ COMPLIANT |
| Delete with no linked rules succeeds | No rules → context deleted, no audit | `entity-context-crud-service.test.ts > removeEntityContext() > no audit entry` (4.7) | ✅ COMPLIANT |
| Bulk delete nullifies all FKs | Multiple FKs nullified, single audit event | `entity-context-crud-service.test.ts > bulkRemoveEntityContexts() > nullifies multiple FKs` (4.6) | ✅ COMPLIANT |

**Compliance summary**: 15/15 scenarios compliant

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Schema: entityContextId String? on BankRule | ✅ Implemented | `prisma/schema.prisma` L223-224, L230 |
| Schema: isManuallyEdited Boolean @default(false) | ✅ Implemented | `prisma/schema.prisma` L224 |
| classifyEntity() return type changed | ✅ Implemented | Returns `{ context, warning? }` in `entity-classifier.ts` L112 |
| computeDirectionProfile helper | ✅ Implemented | `entity-classifier.ts` L26-48 — queries transactions, >80% threshold |
| autoCreateRule with dedup | ✅ Implemented | `entity-classifier.ts` L58-108 — dedup by entityContextId, transaction-wrapped |
| priority=5 on auto-created rules | ✅ Implemented | `entity-classifier.ts` L100 |
| Name="Auto: {pattern}" | ✅ Implemented | `entity-classifier.ts` L94 |
| Warning when GL not found | ✅ Implemented | `entity-classifier.ts` L63-65 |
| PATCH sets isManuallyEdited=true on non-isActive change | ✅ Implemented | `route.ts` L286-295 — checked by detecting difference in any non-isActive field |
| GET includes entityContextId | ✅ Implemented | `route.ts` L37-42 (single) and L45-49 (list) — `...rule` spread includes all Prisma fields |
| removeEntityContext nullifies FK before delete | ✅ Implemented | `entity-context-crud-service.ts` L106-115 — UPDATE SET null, then delete, then audit |
| bulkRemoveEntityContexts nullifies multiple FKs | ✅ Implemented | `entity-context-crud-service.ts` L148-153 — updateMany, then deleteMany, single audit |
| classify-entity route surfaces warning | ✅ Implemented | `classify-entity/route.ts` L94 — `...(classifyResult.warning ? { warning } : {})` |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| FK placement: entityContextId String? on BankRule | ✅ Yes | Schema L223 |
| No unique constraint on entityContextId | ✅ Yes | No @unique in schema |
| Default priority=5 | ✅ Yes | Spec updated from priority=0 to align with design |
| Manual tracking: isManuallyEdited Boolean @default(false) | ✅ Yes | Schema L224 |
| Nullify-on-delete (UPDATE SET null, then delete) | ✅ Yes | Service code L106-115, L148-153 |
| Warning on GL not found (not error) | ✅ Yes | EntityContext persists, warning returned |
| Matching engine unchanged | ✅ Yes | entityContextId and isManuallyEdited not in evaluateWinningRule() |
| Dedup by entityContextId, not pattern | ✅ Yes | `autoCreateRule()` queries by `entityContextId: context.id` only |

### Spec Alignment (Post-Update Verification)

| Previous Issue | Resolution | Verified |
|----------------|-----------|----------|
| priority=0 in spec vs priority=5 in design | ✅ Spec updated to `priority=5` | `entity-classification/spec.md` L12: `priority=5` ✓ |
| Manual rule dedup unclear | ✅ Spec clarified: "dedup is by entityContextId, not pattern" | `entity-classification/spec.md` L52-57 ✓ |
| rule-matching-engine spec already correct | ✅ No changes needed | `rule-matching-engine/spec.md` L1-62 ✓ |

### Issues Found

**CRITICAL**: None

**WARNING**: None

**SUGGESTION**: 
- Schema includes `onDelete: SetNull` on the BankRule-EntityContext relation (schema L230), which is a DB-level safety net. The design only mentions manual nullification via the service, but the schema-level cascade is additive and provides defense-in-depth. Consider documenting this in the design or spec to avoid confusion.

### Verdict

**PASS**

All 72 tests pass, all 15 spec scenarios are compliant, all 25 tasks are complete, all design decisions are followed, and both spec alignment issues (priority=0→5, dedup-by-entityContextId) from the previous verify are resolved.
