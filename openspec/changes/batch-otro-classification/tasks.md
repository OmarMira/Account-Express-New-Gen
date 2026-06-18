# Tasks: Batch OTRO Classification

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600–850 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation) → PR 2 (Core Logic) → PR 3 (UI + i18n) → PR 4 (Tests) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | State overhaul: remove old F4 state/refs, add new batch types and state variables | PR 1 | Base: main. No behavioral change yet, purely structural. |
| 2 | Core handlers: `handlePreClassify`, `handleAcceptSuggestion`, `handleDiscardSuggestion`, modify `handleDescriptionChange`/`handleRoleChange`/`handleSplitChange`/`handleClassifyAll` | PR 2 | Depends on PR 1. All batch API + interaction logic. |
| 3 | UI rendering: button text derivation, inline banner JSX, 13 new i18n keys, remove old i18n keys | PR 3 | Depends on PR 2. Visual changes + i18n. |
| 4 | Tests: remove old F4 tests, add tests for batch flow, state machine, FR-10, FR-11 | PR 4 | Depends on PR 3. Full test coverage. |

## Phase 1: Foundation — State Overhaul

- [x] 1.1 Add `BatchEntry` type and new state variables: `batchResults: Record<string, BatchEntry | null>`, `batchInProgress: boolean`, `descriptionsSnapshot: useRef<Record<string, string>>`
- [x] 1.2 Remove old F4 state: `suggestionLoading`, `suggestionResults`, `suggestionFailures`, `suggestionHidden`, `suggestionHiddenRef`, `firedTexts` ref
- [x] 1.3 Update `useEffect` cleanup: replace suggestion state resets with `batchResults` and `batchInProgress` resets; remove `firedTexts.current = {}`

## Phase 2: Core Implementation — Handlers

- [x] 2.1 Add `handlePreClassify()`: snapshot descriptions, set `batchInProgress`, `Promise.allSettled` over OTRO entities with description, parse each settlement into `batchResults`
- [x] 2.2 Add `handleAcceptSuggestion(name, role)`: `updateSelection(name, 'role', role)` + mark `batchResults[name].status = 'accepted'`
- [x] 2.3 Add `handleDiscardSuggestion(name)`: mark `batchResults[name].status = 'discarded'`
- [x] 2.4 Modify `handleDescriptionChange`: remove `autoAssignPendingSkipped()` and `fireSuggestion()` calls; keep only `setDescriptions()` — also clear batchResults when OTRO description changes
- [x] 2.5 Modify `handleRoleChange`: remove `autoAssignPendingSkipped()` call; remove F4 state cleanup; add cleanup of `batchResults` when switching away from OTRO
- [x] 2.6 Modify `handleSplitChange`: remove `autoAssignPendingSkipped()` call (already clean)
- [x] 2.7 Modify `handleClassifyAll`: remove pre-fire `Promise.all` block and auto-assign loop; keep only the save logic (already clean)
- [x] 2.8 Remove `showAssignableToast()` function entirely
- [x] 2.9 Remove `autoAssignPendingSkipped()` function entirely
- [x] 2.10 Remove `handleAssignSuggestion()` function entirely
- [x] 2.11 Modify `fireSuggestion()`: remove auto-assign and toast logic; keep only the fetch + `batchResults` write (called from `handlePreClassify` only) [N/A — fireSuggestion removed entirely, replaced by inline fetch in handlePreClassify]

## Phase 3: UI + i18n

- [x] 3.1 Add button text derivation: compute label from OTRO presence, `batchInProgress`, and whether any OTRO remain unresolved
- [x] 3.2 Add inline banner JSX inside candidate card render: render per `batchResults[name]` status (`pending` → spinner, `success` → suggestion + 3 buttons, `error` → error message, `accepted` → assigned message, `discarded` → hidden)
- [x] 3.3 Add 13 new i18n keys to `src/i18n/locales/en.ts` under `learning` section
- [x] 3.4 Add 13 new i18n keys to `src/i18n/locales/es.ts` under `learning` section
- [x] 3.5 Remove 7 old F4 i18n keys (`learning.otroAnalyzing`, `suggestionReady`, `suggestionAssign`, `suggestionLowConfidence`, `suggestionDismissed`, `suggestionError`, `otroBlocked`) from both `en.ts` and `es.ts`

## Phase 4: Testing

- [x] 4.1 Remove existing F4 test blocks: "F4 — OTRO AI suggestion" (6 tests), "F4 — Block save (allOtroOrEmpty)" (2 tests) [kept "Block save" — still pass with new button text]
- [x] 4.2 Add test: descriptions snapshot at click prevents mid-batch pollution (FR-11)
- [x] 4.3 Add test: `Promise.allSettled` fires parallel requests with correct bodies
- [x] 4.4 Add test: batch results update per-entity state independently
- [x] 4.5 Add test: `handleAcceptSuggestion` updates role + banner state [covered by existing "shows assigned banner" test + new 4.7 "Classify entities" after accept]
- [x] 4.6 Add test: `handleDiscardSuggestion` hides banner, entity stays OTRO
- [x] 4.7 Add test: button text cycles through all states (Pre clasificar → Clasificando... → Clasificar)
- [x] 4.8 Add test: error response shows error banner, dropdown remains accessible [covered by existing 3.2 test]
- [x] 4.9 Add test: low confidence (<0.7) shows banner with low-confidence indicator [covered by existing 3.2 test]
- [x] 4.10 Add test: modal close aborts in-flight batch requests (FR-10)
- [x] 4.11 Add test: typing during batch does not add new entities to current batch (FR-11)
