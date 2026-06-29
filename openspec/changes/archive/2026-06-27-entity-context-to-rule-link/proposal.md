# Proposal: Entity Context to Rule Link

## Intent

Classifying an entity stores metadata only — Apply All ignores it because no BankRule exists. Auto-create a matching BankRule on classification so Apply All works immediately.

## Scope

### In Scope
- `entityContextId` (FK) + `isManuallyEdited` on BankRule schema + migration
- Auto-create BankRule in `classifyEntity()`: dedup (active→skip, inactive→reactivate, manual with same pattern→untouch)
- `PATCH /api/bank-rules/[id]` sets `isManuallyEdited=true` on non-isActive field change
- DELETE EntityContext nullifies FK before delete (UPDATE then delete)
- Expose `entityContextId` in GET /api/bank-rules; audit log on FK loss

### Out of Scope
- Frontend badge "Derived from classification"
- Detection engine unification (entity-detector.ts vs scan/route.ts)
- Safe apply-all with auto-fallback; E2E/integration tests beyond unit

## Capabilities

### New Capabilities
- None — all changes modify existing capabilities

### Modified Capabilities
- `entity-classification`: `classifyEntity()` gains auto-create BankRule side-effect with dedup rules
- `rule-matching-engine`: BankRule model gains `entityContextId` + `isManuallyEdited`; matching logic unchanged

## Approach

1. **Schema**: Add `entityContextId String?` (FK, sin unique) + `isManuallyEdited Boolean @default(false)` to BankRule → Prisma migration
2. **Auto-create**: After `saveEntityContext`, create BankRule with pattern, glAccountId, transactionDirection (directionProfile: >80% debit→debit, >80% credit→credit, else any), priority=0, isActive=true
3. **Differential PATCH**: Any non-isActive field change → `isManuallyEdited = true`
4. **Nullify on delete**: `UPDATE BankRule SET entityContextId = null WHERE entityContextId = id` THEN delete EntityContext
5. **Response**: Include `entityContextId` in GET /api/bank-rules shape

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modified | FK (sin unique) + isManuallyEdited on BankRule |
| `src/lib/entity-classifier.ts` | Modified | Auto-create rule after classify |
| `src/app/api/bank-rules/[id]/route.ts` | Modified | Differential PATCH; expose FK in GET |
| `src/app/api/learning/classify-entity/route.ts` | Modified | Pass companyId/description to classifier |
| `src/app/api/entity-context/[id]/route.ts` | Modified | DELETE path — nullify FK via crud service |
| `src/lib/services/entity-context-crud-service.ts` | Modified | removeEntityContext & bulkRemove nullify FK before delete |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DELETE entity-context crashes on FK constraint | High | Nullify before delete on ALL paths |
| Manual rules (entityContextId=null) matched as auto-rules | Low | Dedup: never touch manual rules |
| Migration for existing data | Low | FK is optional String — no migration needed |

## Rollback Plan

1. `npx prisma migrate down` to revert schema
2. Revert code changes in all modified files
3. Verify PATCH no longer writes `isManuallyEdited`; DELETE returns to direct delete

## Success Criteria

- [ ] Classify entity → BankRule created with correct direction + pattern
- [ ] Classify same entity again → dedup: active skip, inactive reactivate, manual untouched
- [ ] PATCH non-isActive field → `isManuallyEdited = true`
- [ ] DELETE entity-context with linked rules → FK nullified, audit logged, context deleted
- [ ] Manual rules (entityContextId=null) never modified by auto-create
