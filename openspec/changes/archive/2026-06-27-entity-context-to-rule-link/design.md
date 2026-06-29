# Design: Entity Context to Rule Link

## 1. Technical Approach

After `classifyEntity()` saves/upserts the EntityContext, auto-create (or reactivate) a BankRule linked via `entityContextId`. The rule carries the pattern, GL account, and transaction direction inferred from historical transactions. This makes the "Apply All" matching engine immediately effective for classified entities.

Two side-effects are introduced:
- **PATCH on bank-rules**: any non-`isActive` field change flips `isManuallyEdited=true` — signals the rule is no longer purely auto-generated.
- **DELETE on entity-context**: FK must be nullified on linked BankRules before the context is deleted; audit log records affected rule IDs.

## 2. Architecture Decisions

### Schema

| Decision | Value | Rationale |
|----------|-------|-----------|
| FK placement | `entityContextId String?` on BankRule | One context can power zero-to-many rules (e.g. a context can be updated and generate a new rule) |
| Unique constraint | NO unique | Allows multiple rules from same context in edge cases; dedup handled in application logic |
| Default priority | `priority=5` | See priority decision below |
| Manual tracking | `isManuallyEdited Boolean @default(false)` | Enables dedup logic and future UX ("derived from classification" badge) |

### Priority for Auto-Created Rules

**Decision: `priority=5`** (middle ground, editable via UI)

The matching engine sorts first by role priority (derived from entity role hierarchy), then by DB priority (lower = higher). Options considered:

| Option | Consequence | Verdict |
|--------|-------------|---------|
| `priority=0` | Auto-rules ALWAYS beat manual rules (default `priority=10`). Too aggressive — user cannot override without manually editing priority. | ❌ |
| `priority=10` | Ties with manual default. Same-role tiebreaker is effectively random. Loses the signal that classification-derived rules are data-driven. | ❌ |
| **`priority=5`** | Auto-rules beat default manual rules, but users can set `priority=0-4` to override. Preserves "Apply All works immediately" intent while keeping user control. | ✅ |

**Matching engine unchanged** — `entityContextId` and `isManuallyEdited` do not participate in `evaluateWinningRule()`. Priority alone controls ranking within the same role tier.

### Nullify-on-Delete vs Cascade

| Decision | Rationale |
|----------|-----------|
| **Nullify (`UPDATE SET null` then delete)** | Deleting a classification context should NOT cascade-delete the rule — the rule may have been manually refined or may apply to other contexts. Soft nullification preserves the rule's independent lifecycle. |

### Warning on GL Not Found

| Decision | Rationale |
|----------|-----------|
| **Warning (not error)** | The EntityContext is the primary outcome; the BankRule is a convenience side-effect. A missing GL account shouldn't roll back the classification. The API response includes a `warning` field. |

## 3. Data Flow

### classify → auto-create

```
classifyEntity(input)
  │
  ├─ 1. resolve glAccountId from glAccountCode (existing)
  │
  ├─ 2. saveContext(...) → context (upsert, existing logic)
  │
  ├─ 3. autoCreateRule(context, input):
  │      ├─ Lookup existing BankRule by entityContextId
  │      │   ├─ found + isActive=true  → skip (dedup)
  │      │   ├─ found + isActive=false → reactivate + update fields
  │      │   └─ not found              → create new
  │      │
  │      ├─ Compute direction:
  │      │   └─ computeDirectionProfile(companyId, pattern)
  │      │      └─ query BankTransaction matching pattern
  │      │      └─ debitPct>0.8 → "debit", creditPct>0.8 → "credit", else "any"
  │      │
  │      ├─ If glAccountId is null → skip creation, set warning
  │      └─ Create/Update BankRule:
  │           pattern, glAccountId, transactionDirection,
  │           priority=5, isActive=true, entityContextId
  │
  └─ 4. Return { context, warning? }
```

### DELETE entity-context → nullify FK

```
DELETE /api/entity-context/[id]
  │
  └─ removeEntityContext(companyId, id)
       ├─ Find EntityContext (404 if missing)
       ├─ UPDATE BankRule SET entityContextId=null WHERE entityContextId=id
       ├─ Audit log: record affected rule IDs
       └─ DELETE EntityContext
```

## 4. File Changes

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `entityContextId String?` and `isManuallyEdited Boolean @default(false)` to BankRule; add relation to EntityContext |
| `src/lib/services/entity-classifier.ts` | Change return type from `void` to `{ context: EntityContext; warning?: string }`. Add `autoCreateRule()` and `computeDirectionProfile()` |
| `src/lib/services/entity-context-crud-service.ts` | Modify `removeEntityContext()` and `bulkRemoveEntityContexts()` to nullify FK + audit before delete |
| `src/app/api/bank-rules/[id]/route.ts` | PATCH: detect non-isActive field changes → set `isManuallyEdited=true`. GET: include `entityContextId` in response |
| `src/app/api/entity-context/[id]/route.ts` | DELETE: update response to reflect nullification (no shape change, but add audit) |
| `src/app/api/learning/classify-entity/route.ts` | Update response to surface `warning` field from `classifyEntity()` |

## 5. Interfaces

### Modified `classifyEntity` signature

```typescript
export async function classifyEntity(
  input: ClassifyEntityInput,
): Promise<{ context: EntityContext; warning?: string }>
```

### New helper: direction inference

```typescript
async function computeDirectionProfile(
  companyId: string,
  pattern: string,
): Promise<'debit' | 'credit' | 'any'> {
  const transactions = await db.bankTransaction.findMany({
    where: {
      statement: { bankAccount: { companyId } },
      description: { contains: pattern, mode: 'insensitive' },
    },
    select: { amount: true },
    take: 200,
  });

  if (transactions.length === 0) return 'any';

  const debitCount = transactions.filter((t) => t.amount < 0).length;
  const debitPct = debitCount / transactions.length;
  const creditPct = 1 - debitPct;

  if (debitPct > 0.8) return 'debit';
  if (creditPct > 0.8) return 'credit';
  return 'any';
}
```

### New helper: auto-create dedup

```typescript
async function autoCreateRule(
  companyId: string,
  context: { id: string; pattern: string; glAccountId: string | null },
  direction: 'debit' | 'credit' | 'any',
): Promise<{ rule?: BankRule; warning?: string }>
```

Returns `{ warning: string }` when `glAccountId` is null or the referenced GL account is missing.

### Modified `removeEntityContext`

```typescript
export async function removeEntityContext(
  companyId: string,
  id: string,
): Promise<boolean>
```
Internal change only: adds nullify step before delete. Signature unchanged per existing callers.

## 6. Testing Strategy

Unit tests per scenario (using mocked `db`):

| Scenario | Test |
|----------|------|
| Direction: debit dominant | `computeDirectionProfile()` with 90% debit → returns `"debit"` |
| Direction: credit dominant | `computeDirectionProfile()` with 90% credit → returns `"credit"` |
| Direction: mixed | `computeDirectionProfile()` with 60/40 split → returns `"any"` |
| Direction: no transactions | `computeDirectionProfile()` with empty set → returns `"any"` |
| Dedup: active rule exists | `autoCreateRule()` finds active rule → returns without changes |
| Dedup: inactive rule exists | `autoCreateRule()` finds inactive rule → reactivates + updates fields |
| Dedup: manual rule same pattern | `autoCreateRule()` finds rule with `entityContextId=null` → untouched |
| GL not found | `classifyEntity()` with null glAccountId → context saved, warning returned, no rule created |
| Happy path: full flow | Classification → context saved + rule created with correct direction & priority=5 |
| PATCH non-isActive field | PATCH `pattern` → `isManuallyEdited=true` |
| PATCH only isActive | PATCH `isActive` → `isManuallyEdited` stays false |
| Delete with linked rules | `removeEntityContext()` → FK nullified before context delete, audit logged |
| Delete no linked rules | `removeEntityContext()` → context deleted without side-effects |
| Bulk delete | `bulkRemoveEntityContexts()` → all FKs nullified, one audit event |

## 7. Migration / Rollout

```bash
npx prisma migrate dev --name add_entity_context_link_to_bank_rule
```

The migration adds two nullable/optional columns with defaults. No data backfill needed.

**Rollback**: `npx prisma migrate down` + revert code changes. The nullify-on-delete behavior is backward-compatible for existing data.

### Deployment order

1. Schema migration (safe: additive only)
2. Deploy code changes in any order (new columns are nullable)
3. Verify PATCH behavior and DELETE nullification in staging

## 8. Open Questions

1. **Direction profile source**: The `computeDirectionProfile()` helper queries BankTransaction descriptions with a loose `contains` match. Should this use pattern normalization (e.g. `normalizePattern()` from `pattern-normalizer.ts`) for consistency with entity detection?
2. **Concurrent classification of same pattern**: `saveContext()` uses upsert → safe for EntityContext. But two concurrent calls could race on the BankRule dedup check — wrap in a Prisma transaction with `$transaction`?
3. **Rule name for auto-created rules**: The spec and spec don't define how `name` is set. Proposal: `"Auto: {pattern}"` to distinguish from manual rules in the UI.
