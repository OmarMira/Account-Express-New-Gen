# Proposal: Human-Confirmed Smart Classification

## Intent

Make aggregation-before-classification the premise: transactions -> detect entity -> aggregate entity history -> classify with context -> suggest role/intent with confidence -> human confirms -> learn/create safe rule. Current clustering is partial; the missing architecture is a formal entity history analysis layer between entity detection and classification.

## Scope

### In Scope
- Human-confirmed role/intent suggestions with simple explanations.
- Backend aggregation, confidence, review, confirmation, learning gates.
- Cold-start behavior for first-time entities and insufficient history.
- No final `BankRule`/accounting automation until confirmation.

### Out of Scope
- Final `OTHER`/`OTRO` role/intent; accounting-jargon-first UX; autonomous automation.

## Required Capabilities

1. **Entity aggregation layer/service**: before classification, group transactions for the same detected entity/name and calculate count, accumulated amount, dominant direction (`credit`/`debit`/`mixed`), active months, average interval, frequency label, representative descriptions, recent descriptions, amount range/average.
2. **LLM prompt enriched with accumulated entity summary**: classify from entity history, not one memo. Prompt examples are illustrative only; implementation must generate generic prompts from actual tenant/company data and never hardcode the example entity/person.
   ```text
   Entity: "Laura Quijano"
   History: 83 transactions in 12 months, $62,302 total, 100% outflows
   Frequency: biweekly/monthly
   Payment types: AmEx, Toyota, Kia, direct Zelle
   Recent descriptions: ...
   Classify this entity's role and likely transaction intent.
   ```
   This context lets the LLM infer instead of forcing operator choice.
3. **Direction as first-class input**: use direction in heuristics, prompt, and confidence. Recurring 100% inflows can suggest tenant/customer; recurring 100% outflows can suggest vendor/partner/fixed expense; mixed direction usually requires review.
4. **Recurrence detection**: compute monthly/biweekly/weekly/sporadic/one-time from intervals for the same entity to distinguish tenant/customer/vendor/contractor/one-off payments.
5. **Cold-start and insufficient-history gate**: first-time entities or entities below a configurable high-confidence threshold (for example: minimum occurrences, active months, or recurrence confidence) must produce low/medium confidence, not final automation. The system may suggest from single-transaction signals only as provisional, require confirmation, and otherwise mark pending review with one plain-language question.
6. **Re-evaluation lifecycle**: entities remain eligible for re-evaluation as history accumulates. Later evidence must not overwrite a user-confirmed classification automatically; it may suggest an update when evidence conflicts.

## Capabilities

### New Capabilities
- `human-confirmed-smart-classification`: Aggregated history suggestions, confidence, confirmation, explanations, learning.

### Modified Capabilities
- `entity-classification`: History-aware classification; uncertainty remains review.
- `transaction-intent`: Intent derives from confirmed plain-language suggestions.
- `entity-role-suggestion`: Expands OTRO-only prompting to context-rich role/intent suggestions.
- `rule-matching-engine`: Matching unchanged; automation confirmation-gated.

## Approach

Backend remains source of truth. Build history first, apply the minimum-history threshold, then run heuristics plus optional LLM using direction, recurrence, amounts, descriptions, and confirmations. Show a human-language explanation and either ask for confirmation or one review question when confidence is too low.

## Affected Areas

Later implementation affects `src/lib/services/entity-classifier.ts`, `src/lib/services/*entity*`, `src/app/api/learning/*`, and `src/components/learning/EntityOnboardingModal.tsx` (dirty file must be preserved).

## Risks

- Authoritative-feeling suggestions: require confirmation and show reasons.
- Mixed-direction entities: bias to review.
- Cold-start overconfidence: cap confidence until minimum history is met.
- Review budget: split below 400 changed lines.

## Rollback Plan

Disable suggestion UI/API and fall back to manual classification. Keep persistence additive/nullable; never migrate uncertainty into final `OTHER`/`OTRO`.

## Dependencies

- Existing `entity-classification`, `transaction-intent`, `entity-role-suggestion`, `rule-matching-engine` specs.
- Related active change: `entity-classification-workflow-state`.

## Success Criteria

- [ ] Suggestions use aggregated entity history before classification.
- [ ] Direction and recurrence affect heuristics, prompt, confidence.
- [ ] Insufficient history yields provisional suggestions or pending review, not automation.
- [ ] Reclassification never overwrites user-confirmed classifications automatically.
- [ ] Operators confirm in plain language before learning/rule creation.
- [ ] No automatic accounting automation happens before confirmation.
- [ ] No final `OTHER`/`OTRO` persisted classification is created.
