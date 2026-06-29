# Domain 4: LLM Low-Confidence Guard

## Overview

All LLM-generated suggestions (role, account, intent) are forced to a maximum confidence of 0.69 at the server side. This ensures suggestions are treated as LOW confidence by the existing frontend gating mechanism. Apply All skips LOW items entirely. No LLM suggestion triggers autoCreateRule without explicit user confirmation.

## Requirements

| ID | Description | Priority |
|---|---|---|
| REQ-LLM-01 | The suggestion endpoint (/api/learning/suggest-role or equivalent) MUST cap response confidence to a maximum of 0.69 for LLM-generated suggestions | P0 |
| REQ-LLM-02 | The Apply All endpoint MUST skip items where confidence < 0.7 | P0 |
| REQ-LLM-03 | LLM-suggested intents MUST NOT trigger autoCreateRule without explicit user confirmation | P0 |
| REQ-LLM-04 | The frontend MUST show a visual indicator for LOW confidence items (e.g., warning icon, muted styling) | P1 |

## Scenarios

### SCEN-LLM-01: Server-side confidence capping

**Given** the `/api/learning/suggest-role` endpoint
**When** the LLM returns a suggestion with confidence ≥ 0.7 (e.g., 0.92)
**Then** the response `confidence` field is capped to `0.69`
**And** the HTTP response body contains `"confidence": 0.69`
**And** the original confidence value from the LLM is discarded (not exposed to the client)
**And** when the LLM returns confidence < 0.7 (e.g., 0.45), the value is preserved as-is

### SCEN-LLM-02: Apply All excludes LOW confidence

**Given** the Apply All endpoint (e.g., `/api/learning/apply-all` or `/api/bank-rules/apply-all`)
**When** processing candidate suggestions
**Then** any item with `confidence < 0.7` is skipped
**And** the response summary reports the count of skipped items
**And** no BankRule is created or modified for skipped items

### SCEN-LLM-03: No autoCreate for LLM suggestions

**Given** an LLM-suggested role response with `confidence: 0.69`
**When** the suggestion is presented to the user via the batch result banner
**Then** no automatic call to `autoCreateRule()` occurs
**And** the user must explicitly click "Accept" / "Confirm" before the rule is created
**And** the `classify-entity` endpoint only invokes `autoCreateRule` when the source is `user`, not `ai`

### SCEN-LLM-04: Frontend LOW confidence indicator

**Given** a batch result banner with `confidence < 0.7`
**When** the banner renders
**Then** the confidence text uses muted/warning styling (e.g., `text-yellow-600` as in existing code line 943-946)
**And** the label shows "Low confidence: {percent}%" instead of "Confidence: {percent}%"
**And** the Accept button is still available (user can still manually confirm)
**And** the existing confidence color logic at `EntityOnboardingModal.tsx` lines 943-946 is preserved

## Constraints

- The confidence cap is ENFORCED SERVER-SIDE. The frontend cannot bypass it.
- The existing frontend confidence check (EntityOnboardingModal.tsx line 943: `result.confidence >= 0.7`) is sufficient — LOW items already get distinct styling. No frontend changes to the gating logic are needed, only UI consistency.
- The `suggest-role` endpoint applies the cap in the response handler, not in the LLM prompt.
- For strict TDD: test that the cap is applied at the API boundary, not in the LLM call.

## Files Affected

| File | Action |
|------|--------|
| `src/app/api/learning/suggest-role/route.ts` (or equivalent) | **Modified** — cap confidence to min(raw, 0.69) |
| `src/app/api/learning/apply-all/route.ts` (or equivalent) | **Modified** — skip items with confidence < 0.7 |
| `src/lib/services/entity-classifier.ts` | **Modified** — `classifyEntity()` only auto-creates rule for `source: 'user'` |
| `src/components/learning/EntityOnboardingModal.tsx` | **No change needed** — existing confidence-based styling already handles LOW display |
