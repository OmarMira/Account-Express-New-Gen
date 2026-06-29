# Domain 5: Rule Split Confirmation

## Overview

When the system detects a transaction that doesn't match existing rules, it MAY suggest creating a new rule, but the rule MUST NOT be automatically created. The user must explicitly confirm the suggestion. This applies to split suggestions and any new-rule proposal originating from LLM or detection logic.

## Requirements

| ID | Description | Priority |
|---|---|---|
| REQ-SPLIT-01 | When the system detects a transaction that doesn't match existing rules, it MAY suggest creating a new rule | P0 |
| REQ-SPLIT-02 | The suggestion MUST be presented to the user as a confirmation card/dialog with the proposed intent and GL account | P0 |
| REQ-SPLIT-03 | The new rule MUST NOT be created until the user explicitly clicks "Confirm" or equivalent | P0 |
| REQ-SPLIT-04 | The split suggestion MUST include the reasoning (why the existing rules don't match) | P1 |

## Scenarios

### SCEN-SPLIT-01: Suggestion presented as confirmation card

**Given** an unmatched transaction is processed by the suggestion/detection flow
**When** the system identifies a candidate for a new rule or split
**Then** a confirmation card is displayed in the UI showing:
- The proposed intent (e.g., `RENT_PAYMENT`)
- The proposed GL account name and code
- The direction (debit/credit/any)
- The entity pattern (e.g., landlord name)

**And** the card includes a "Confirm" button and a "Dismiss" button
**And** no other action creates the rule automatically

### SCEN-SPLIT-02: Rule not created without confirmation

**Given** a confirmation card is shown to the user
**When** the user closes the modal or navigates away without clicking "Confirm"
**Then** no BankRule is created
**And** no side-effect mutations occur in the database
**And** the unmatched transaction remains unmatched

### SCEN-SPLIT-03: Reasoning included

**Given** a suggestion card
**When** the card renders
**Then** it includes a brief explanation of why no existing rule matched (e.g., "No rule matching pattern 'JOHN DOE' found")
**And** if applicable, it notes any partial matches (e.g., "Similar to existing rule 'Rent' but amount range differs")

### SCEN-SPLIT-04: Existing split UI preserved

**Given** the existing split UI (EntityOnboardingModal.tsx lines 814-856) for mixed-direction entities
**When** a user selects to split an entity (credit-only / debit-only)
**Then** the existing split behavior is preserved
**And** each split entity separately requires confirmation before rule creation
**And** the intent dropdown on each split entity card can be independently set

## Constraints

- No automatic `autoCreateRule` for any LLM-sourced or detection-sourced suggestion. Only user-initiated actions (clicking "Confirm", "Classify", "Accept") trigger rule creation.
- The confirmation card uses existing UI patterns (e.g., the suggestion banner at EntityOnboardingModal.tsx lines 936-976).
- Reasoning text is a localized string passed from the backend alongside the suggestion data.

## Files Affected

| File | Action |
|------|--------|
| `src/components/learning/EntityOnboardingModal.tsx` | **No structural change** — existing confirmation pattern (suggestion banner + Accept/Discard) already satisfies this requirement |
| `src/app/api/learning/suggest-role/route.ts` (or equivalent) | **Modified** — include `reasoning` field in response |
| `src/i18n/locales/en.ts` | **Possibly modified** — add reasoning-related i18n keys if needed |
| `src/i18n/locales/es.ts` | **Possibly modified** — add reasoning-related i18n keys if needed |
