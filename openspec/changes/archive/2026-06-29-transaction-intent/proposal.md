# Proposal: Transaction Intent

## Intent

Transactions currently apply to GL accounts but carry no semantic reason — the system doesn't know *why* money moved. Adding a `TransactionIntent` enum (LOAN_PAYMENT, RENT_PAYMENT, etc.) lets the system capture the business purpose of each transaction. This enables intent-based rule matching, better reporting, and smarter LLM suggestions — all without changing the existing deterministic matching core.

## Scope

### In Scope
- `TransactionIntent` Zod enum + Prisma enum enforced at DB level
- Optional `intent` field on `BankRule` (non-destructive migration)
- EntityOnboardingModal: show read-only Actor Type + intent dropdown (bilingual EN/ES)
- LLM suggestions always tagged `confidence: 'low'`, never auto-applied, excluded from Apply All
- Deterministic matching preserved — no scoring changes
- Split/new-rule suggestions always require user confirmation

### Out of Scope
- Actual intent-based matching in the engine (future: intent can participate in scoring after this foundation is laid)
- Persisting intent on `BankTransaction` (deferred — intent flows through the rule)
- Batch intent assignment or AI-driven intent prediction without user confirmation
- Changes to the matching algorithm (tokenOverlap, aliasExpansionScore, etc.)

## Capabilities

### New Capabilities
- `transaction-intent`: TransactionIntent enum definition (Zod + Prisma), bilingual labels, validation at both application and DB layer

### Modified Capabilities
- `entity-classification`: EntityOnboardingModal shows Actor Type + intent selector; LLM suggestions forced to LOW confidence; split/new-rule requires user confirmation
- `rule-matching-engine`: BankRule Prisma model gains optional `intent TransactionIntent?` field

## Approach

1. **Enum definition**: Create a shared `TransactionIntent` const array + Zod enum + Prisma enum in schema. DB gets native enum type via `@pgEnum` or native Prisma enum syntax.
2. **BankRule migration**: Add `intent TransactionIntent?` to BankRule, generate non-destructive migration, wire into API response shapes.
3. **UI**: In EntityOnboardingModal, above the role dropdown, show the entity's Actor Type (from entity-roles/EXPECTED_DIRECTION) as read-only text. Below it, add the intent `<Select>` with bilingual labels from i18n keys `transactionIntent.{key}.{en,es}`.
4. **LLM guard**: The `/api/learning/suggest-role` endpoint caps `response.confidence` to `0.69` max. Frontend already gates on confidence — Apply All buttons exclude LOW items.
5. **Apply confirmation**: The match/apply flow for unmatched transactions shows a suggestion card with intent + account. The user clicks a confirm button before any rule creation. No automatic `autoCreateRule` for LLM-sourced intents.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modified | Add `enum TransactionIntent` + `intent` field on `BankRule` |
| `prisma/migrations/` | New | Non-destructive migration for new field |
| `src/lib/constants/transaction-intent.ts` | New | Shared Zod enum + const array (LOAN_PAYMENT, etc.) |
| `src/components/learning/EntityOnboardingModal.tsx` | Modified | Actor Type label + intent dropdown |
| `src/lib/services/entity-classifier.ts` | Modified | autoCreateRule must NOT auto-create for LOW-confidence / unconfirmed suggestions |
| `src/i18n/locales/{es,en}.ts` | Modified | Add `transactionIntent.*` bilingual keys |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DB enum migration locks table on large pg DBs | Low | Run during low-traffic window; field is optional so no backfill needed |
| Existing LLM suggestion flow auto-applies despite LOW tag | Low | Frontend already checks confidence; add server-side guard in suggest-role endpoint |
| UI overcrowding from Actor Type + intent fields | Low | Use compact layout: Actor Type as inline badge, intent as compact select |

## Rollback Plan

1. Revert Prisma schema (remove `intent` enum + field)
2. Generate a second migration that drops the column and enum type (CASCADE if referenced)
3. Revert UI changes in EntityOnboardingModal
4. Remove i18n keys

## Dependencies

- None — the `intent` field is optional, backward compatible

## Success Criteria

- [ ] `TransactionIntent` enum exists in both Zod schema and Prisma schema with identical 8 values
- [ ] `prisma migrate dev` creates a non-destructive migration with no data loss
- [ ] EntityOnboardingModal shows read-only Actor Type and an intent dropdown with bilingual labels
- [ ] LLM suggestion endpoint never returns confidence >= 0.7
- [ ] Apply All excludes items with LOW confidence suggestions
- [ ] No new scoring formulas added to rule-matching-engine.ts
- [ ] Split/new-rule flow blocks creation until user explicitly confirms
