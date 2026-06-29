# Domain 3: Entity Onboarding UI — Actor Type + Intent Selector

## Overview

Enhance `EntityOnboardingModal` to show the entity's Actor Type (from entity-roles / EXPECTED_DIRECTION) as a read-only contextual label, and add a `TransactionIntent` dropdown with bilingual labels (EN/ES) for optional intent selection.

## Requirements

| ID | Description | Priority |
|---|---|---|
| REQ-UI-01 | EntityOnboardingModal MUST show the entity's Actor Type (from entity-roles) as read-only text/label | P0 |
| REQ-UI-02 | EntityOnboardingModal MUST include a dropdown/select for TransactionIntent | P0 |
| REQ-UI-03 | The dropdown labels MUST use bilingual i18n keys (EN/ES based on locale) | P0 |
| REQ-UI-04 | The intent selection is optional — user can leave it unset | P0 |
| REQ-UI-05 | When intent is selected, the auto-create rule includes the intent value | P1 |

## Scenarios

### SCEN-UI-01: Actor Type shown as read-only label

**Given** an entity candidate with role `INQUILINO` (via dropdown selection)
**When** the EntityOnboardingModal renders
**Then** the entity card shows a read-only label/badge displaying `INQUILINO` (the Actor Type)
**And** the label is visually distinct from editable controls (e.g., muted background, no border, no hover effect)
**And** the label updates automatically when the user changes the role selection
**And** when no role is yet selected, no Actor Type label is shown

### SCEN-UI-02: Intent dropdown present and bilingual

**Given** the EntityOnboardingModal is open with at least one entity candidate
**When** the user scrolls to an entity card
**Then** there is a `<Select>` or equivalent dropdown labeled with the i18n key `learning.intentLabel` (or equivalent)
**And** the dropdown contains one option per TransactionIntent value
**And** each option displays the bilingual label according to the current locale (e.g., "Rent Payment" in EN, "Pago de Renta" in ES)
**And** the first option is an empty/unset placeholder (e.g., `learning.intentPlaceholder`)
**And** the Select component uses the same pattern as the existing role `<Select>` (shadcn/ui Select)

### SCEN-UI-03: Intent selection is optional

**Given** the intent dropdown
**When** the user does not select any intent value (remains unset/placeholder)
**Then** the entity can still be classified and saved without intent
**And** the auto-created rule (via autoCreateRule) has `intent = null`
**And** the UI does not block or warn about the missing intent

### SCEN-UI-04: Intent propagated to autoCreateRule

**Given** the user selects an intent (e.g., `RENT_PAYMENT`) in the dropdown
**When** they proceed to classify the entity (via Pre-classify or Classify All)
**Then** the `classify-entity` API call includes the selected intent
**And** `autoCreateRule()` creates the BankRule with `intent = "RENT_PAYMENT"`
**And** the saved entity reflects the intent selection in subsequent views

### SCEN-UI-05: Layout integration

**Given** the existing entity card layout (role dropdown, direction label, split UI, OTRO textarea)
**When** the Actor Type label and intent dropdown are added
**Then** the layout remains compact and usable on a modal with `max-w-3xl`
**And** the Actor Type label is positioned above or adjacent to the role dropdown
**And** the intent dropdown is positioned below the role area or in a dedicated row
**And** both additions use existing spacing and typography tokens

## Constraints

- Actor Type is derived from the selected role and a mapping file (entity-roles.json or EXPECTED_DIRECTION). It is NOT a free-text field.
- The intent dropdown uses the shared `TRANSACTION_INTENT_VALUES` const array as its data source.
- Bilingual labels use existing i18n `t()` function from `useLanguageStore`.
- No new CSS or component library additions — use existing shadcn/ui `<Select>` and badge patterns.
- The intent dropdown is added INSIDE each entity card (per-entity), not as a global modal setting.

## Files Affected

| File | Action |
|------|--------|
| `src/components/learning/EntityOnboardingModal.tsx` | **Modified** — add Actor Type label + intent Select |
| `src/i18n/locales/en.ts` | **Modified** — add `learning.intentLabel`, `learning.intentPlaceholder` keys |
| `src/i18n/locales/es.ts` | **Modified** — add `learning.intentLabel`, `learning.intentPlaceholder` keys |
