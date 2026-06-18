## Exploration: batch-otro-classification

### Current State

The OTRO AI suggestion flow operates as a **real-time per-keystroke** system with auto-assignment. Here's the exact current behavior:

#### State Variables (F4 section, lines 116-135)
- `descriptions`: `Record<string, string>` — one textarea value per entity
- `suggestionLoading`: `Record<string, boolean>` — per-entity loading indicator
- `suggestionResults`: `Record<string, { suggestedRole, confidence, explanation } | null>` — per-entity AI results
- `suggestionFailures`: `Record<string, number>` — consecutive low-confidence count per entity
- `suggestionHidden`: `Record<string, boolean>` — permanently hides textarea after 2 consecutive failures

#### Refs for synchronous access (lines 191-197)
- `firedTexts.current`: tracks which text was already sent to the API per entity (prevents re-firing identical text)
- `abortControllers.current`: per-entity AbortController for cancelling in-flight requests
- `loadingRef.current`: synchronous mirror of `suggestionLoading`
- `selectionsRef.current`: synchronous snapshot of selections for closure-safe access

#### `fireSuggestion()` (lines 199-277) — called on EVERY keystroke (≥5 chars)
1. Aborts any existing in-flight request for that entity
2. Creates new AbortController
3. POSTs to `/api/learning/suggest-role` with `{ description }` only
4. On **confidence ≥ 0.7**:
   - Marks text as fired (dedup)
   - Checks if user hasn't changed role since request started (`selectionsRef` defense)
   - Stores result in `suggestionResults`
   - Shows assignable toast (15s duration, with ASIGN button + X dismiss)
   - **Auto-assigns via `handleAssignSuggestion()`** — immediately sets role, clears description, clears suggestion state
5. On **confidence < 0.7**:
   - Increments failure counter
   - After 2 consecutive failures → permanently hides suggestions for that entity
   - Shows info toast asking for more description
6. On **error** (except AbortError):
   - Shows error toast

#### `handleDescriptionChange()` (lines 664-678) — inline in render
- Calls `autoAssignPendingSkipped(name)` to fire pending suggestions for OTHER entities
- Updates description state
- **If trimmed length ≥ 5 chars AND text not already fired → immediately fires `fireSuggestion()`**

#### `autoAssignPendingSkipped()` (lines 401-437)
- Called when user interacts with ANY entity (role change or description change)
- Iterates ALL other entities:
  1. Fires pending suggestions for any OTRO entity that has text ≥5 chars not yet fired
  2. Auto-assigns existing high-confidence results for any OTRO entity still pending
- This creates a cascading effect: changing one entity triggers suggestions for ALL others

#### `handleRoleChange()` (lines 440-465)
- Calls `autoAssignPendingSkipped()` before changing current entity
- If new role is NOT OTRO → aborts in-flight, clears ALL suggestion state for that entity
- If new role IS OTRO → immediately fires suggestion if description ≥5 chars exists

#### `handleClassifyAll()` (lines 468-585) — the save pipeline
1. **Before saving**: fires pending suggestions for all OTRO entities with descriptions not yet sent
2. **Before saving**: auto-assigns any pending high-confidence results
3. Reads from `selectionsRef.current` (closure-safe)
4. Iterates all selections:
   - SKIP if role is OTRO (OTRO is never saved — line 507)
   - SKIP if role is empty/falsy
   - If split → saves with suffixed pattern
   - Otherwise → normal save with optional `directionOverride`
5. Shows toast with count (warns if some were skipped)
6. Calls `onComplete()` then `onClose()`

#### Save button disabled logic (lines 588-592)
- `allOtroOrEmpty` is `true` when all selections are OTRO or empty
- Button is enabled ONLY when at least one entity has a non-OTRO role selected
- Button text: `"Classify ({count})"` where count = total entities with selections

#### API endpoint `POST /api/learning/suggest-role` (route.ts)
- Pure AI classification endpoint
- No company context needed
- Returns `{ suggestedRole, confidence, explanation }`
- Validates: description ≥3 chars, prompt injection guard, ENTITY_ROLES validation
- Timeout 10s per model, fallback to alternate models
- Currently does NOT receive `directionProfile`, `sampleDescriptions`, or `existingRoles`

### Behavioral Summary

| Trigger | What happens |
|---------|-------------|
| User selects OTRO | Textarea appears |
| User types ≥5 chars | `fireSuggestion()` fires immediately (no debounce) |
| AI returns ≥0.7 confidence | Auto-assigns role + shows toast (15s) |
| AI returns <0.7 | Info toast, textarea stays active |
| 2 consecutive failures | Textarea permanently hidden |
| User changes another entity | Fires suggestions for ALL pending OTRO entities |
| User clicks "Classify" | Fires pending suggestions, auto-assigns results, saves non-OTRO |
| User changes role back from OTRO | Aborts in-flight, clears all suggestion state |

### Affected Areas

- `src/components/learning/EntityOnboardingModal.tsx` — **Primary**: rewrite F4 section (lines 116-478), revise save button disabled logic (lines 588-592), update button text (line 846), add batch-review UI (modal or inline section), possibly add batch-review state (reviewResults, reviewModalOpen)
- `src/app/api/learning/suggest-role/route.ts` — Minor: add `directionProfile`, `sampleDescriptions`, `existingRoles` to request body for richer context (only needed if we want higher-quality batch results)
- `src/lib/constants/role-account-map.ts` — Unchanged
- `src/lib/constants/entity-roles.ts` — Unchanged
- `src/store/language-store.ts` — Unchanged (but new translation keys needed)
- `src/lib/i18n.ts` — New translation keys needed (button text, batch-review UI copy)
- `tests/components/EntityOnboardingModal.test.tsx` — **Major rewrite**: all F4 tests (lines 242-468) need to be rewritten for batch flow; save button tests (lines 513-553) need adjustment; new tests for the batch-review step
- `src/components/spa/ImportPage.tsx` (line 680) — Unchanged (`onComplete` prop not used)
- `src/components/spa/BankRulesPage.tsx` (line 854) — Unchanged (`onComplete` prop not used)

### Approaches

#### Approach A: "Accordion Review" — collect suggestions inline, review per-entity before save

**How it works:**
1. User types descriptions for each OTRO entity (as today)
2. "Clasificar entidades" button changes to **"Pre clasificar entidades"** when OTRO entities exist (no debounce)
3. User clicks "Pre clasificar entidades"
4. All OTRO entities fire `fireSuggestion()` in parallel (batch)
5. Results stream in — each OTRO card shows an inline suggestion banner:
   - "🤖 PROVEEDOR (92%) — coincides con 95% débito" 
   - Buttons: [✅ Asignar] [✏️ Corregir] [❌ Descartar / Seguir OTRO]
6. User can accept/reject/adjust each suggestion individually
7. Once all OTRO entities are resolved (no remaining OTRO without role), the button changes to "Clasificar" (save)
8. Save skips OTRO as before

**Pros:**
- No new modal/overlay needed — everything stays in the existing card layout
- Each entity's context (direction profile, descriptions) is visible during review
- Familiar UX pattern (accordion/expandable suggestions)
- Per-entity granularity: user can accept some, reject others
- Button text change communicates the new workflow clearly
- No broken UX for low-confidence entities
- Test changes are additive (new inline suggestion banner tests)

**Cons:**
- Can be visually busy if there are 20+ OTRO entities with all suggestion banners expanded
- User must scroll to see all results
- No "accept all high-confidence" bulk action
- Still possible for user to accidentally leave entities as OTRO and try to save

**Effort:** Medium

#### Approach B: "Review Modal" — dedicated modal step between pre-classification and save

**How it works:**
1. User types descriptions for each OTRO entity (as today)
2. Button shows "Pre clasificar entidades" when OTRO entities exist
3. Click → fires all suggestions in parallel; shows a **loading overlay/spinner**
4. When all results return → opens a **review modal** showing a clean summary table:
   | Entity | Description | Suggeste dRole | Confidence | Action |
   |--------|------------|----------------|------------|--------|
   | MERCADO PAGO | pagos servicios | PROVEEDOR | 92% | ✅ Accept |
   | JUAN PEREZ | sueldos | EMPLEADO | 88% | ✅ Accept |
   | TAXI SRL | viajes | GASTO_OPERATIVO | 45% | ✏️ Select... |
5. User can bulk-accept (all ≥70%) or individual accept/reject/adjust
6. Click "Confirmar clasificaciones" → applies all accepted, saves, closes

**Pros:**
- Clean, focused review experience — no distractions
- Bulk action for high-confidence suggestions
- Supports sorting by confidence for prioritize review
- Clear separation of concerns: describe → batch-classify → review → save
- Scales well to 50+ entities (table view vs cards)
- Easy to show summary: "12/15 sugerencias de alta confianza"

**Cons:**
- New component/modal to build and maintain
- Another modal on top of a modal (dialog inception)
- User loses context of each entity's direction profile and split state during review
- More complex state machine (review modal open/close, pending accept state)
- More test surface area

**Effort:** High

#### Approach C: "Progressive Disclosure" — hybrid of Approach A with collapsible suggestions

**How it works:**
Same as A but suggestions are collapsed by default:
1. Each OTRO card shows a small "🤖 Sugerencia disponible" badge after batch runs
2. User clicks an entity or the badge to expand the suggestion
3. Expanded view shows the same accept/reject/adjust buttons
4. Once ALL OTRO entities are resolved, button changes from "Pre clasificar" to "Guardar clasificaciones"
5. Bulk-accept all ≥70% could be done via a button in the footer

**Pros:**
- Cleanest default view (no visual clutter)
- User has control over what to review
- Combines well with entity order (review most important entities first)
- Least disruptive to existing layout

**Cons:**
- Users may miss available suggestions (hidden by default)
- Extra interaction to see each suggestion
- Harder to show "accept all" when suggestions are collapsed

**Effort:** Medium

### Recommendation

**Approach A (Accordion Review)** with these adjustments:

1. **Button text change**: `t('learning.preClassify')` ("Pre clasificar entidades") when there are OTRO entities with text; `t('learning.classifyCount')` when no OTRO entities remain OR all OTRO entities have resolved (role changed to non-OTRO)
2. **Batch fire**: On click, fire all OTRO suggestions in parallel (already have `Promise.all` in `handleClassifyAll`) — no more per-keystroke firing
3. **Inline suggestion banners**: Each OTRO card shows a suggestion result card within the entity card, NOT a toast. Buttons: [✅ Asignar] [❌ Descartar] [✏️ Editar rol manual]
4. **No auto-assign**: AI NEVER auto-assigns anymore. The system collects results, shows them, user decides.
5. **Low confidence handling**: Show the suggestion anyway with low confidence indicator — let user decide instead of punishing with hidden textarea. Keep textarea editable for refinement.
6. **Save button blocks**: If any entity is still OTRO with no accepted suggestion, button says "Pre clasificar..." and is disabled. Only when all entities have a non-OTRO role does the button enable for save.

**Why Approach A over the others:**
- **Least disruption** to the existing layout — cards stay, suggestion banners fit naturally
- **No modal inception** — avoids the awkward "modal on top of modal" UX that Approach B has
- **Full context visibility** — user sees direction profile, split state, and description alongside the suggestion (unlike B)
- **Preserves existing scrolling UX** — entity cards remain the primary interaction model
- **Easiest to test** — inline banners are well-supported by the existing test patterns
- **No auto-assign surprises** — users complained about auto-assign (implied by the task requirement). This is the #1 UX improvement.

### Risks

1. **Race conditions on batch fire**: Multiple parallel `fireSuggestion()` calls could update `suggestionResults` in unpredictable order. Need a batch-specific queue or `Promise.allSettled` with per-entity resolution tracking.
2. **Failed suggestions block save**: If AI is down and an entity stays OTRO, the user is blocked. Should allow manual role selection as fallback (dropdown still visible).
3. **Existing autoAssignPendingSkipped logic**: This function currently cascades suggestions on every interaction. Must be DISABLED in the new flow — it conflicts with explicit batch.
4. **firedTexts ref becomes obsolete**: Since we no longer fire on keystroke, `firedTexts.current` dedup logic changes significantly. May be simpler to remove it and use a batch-specific ref.
5. **Button text localization**: "Pre clasificar entidades" needs to work in both `es` and `en` locales. Check `src/lib/i18n.ts` for how existing keys are structured.
6. **Test rewrite scope**: All F4 tests (approximately 8 tests) need complete rewriting. The save button tests also reference OTRO/enable behavior.
7. **Existing behavior regression**: The `autoAssignPendingSkipped` and per-keystroke fire logic touches `handleRoleChange`, `handleDescriptionChange`, and `handleClassifyAll`. Removing/changing these requires careful audit.
8. **onComplete usage**: Neither ImportPage nor BankRulesPage passes `onComplete`. The prop exists but is unused. The flow can change without affecting parents, but verify no edge case.

### Ready for Proposal

**Yes** — the codebase has been thoroughly analyzed. The orchestrator has clear understanding of:
- Every state variable, ref, handler, and effect in the OTRO flow
- The save pipeline and button disabled logic
- The API contract and its limitations (missing direction profile context)
- The test surface and what needs to change
- Two viable approaches with clear tradeoffs

The user should understand that this is a **medium-to-high effort change** primarily due to test rewrite scope and the need to carefully unwind the cascading auto-assignment logic (`autoAssignPendingSkipped` is called from 3 different handlers).
