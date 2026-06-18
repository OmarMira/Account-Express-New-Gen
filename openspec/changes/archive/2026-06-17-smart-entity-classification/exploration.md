# Exploration: smart-entity-classification

## Current State

### Feature 1: Validate canonical roles on EntityContext save

**Today:** The system accepts **any string** as role on EntityContext save. The validation chain is:

- `src/lib/validations/entity-context.ts` — `entityContextSchema` defines `role: z.string().min(1).max(50)` — **no enum restriction**
- `saveContext()` in `entity-context-service.ts` uses `entityContextSchema.parse()` — passes arbitrary strings
- `POST /api/learning/context/route.ts` uses `entityContextSchema` — no role validation
- `PATCH /api/entity-context/[id]/route.ts` — **zero validation**, just passes `body.role` directly to `updateEntityContext()`
- `POST /api/learning/entities/route.ts` — **the only route** that validates via `entityRoleSchema` (z.enum(ENTITY_ROLES))
- `classifyEntity()` in `entity-classifier.ts` passes role directly to `saveContext()` -> `entityContextSchema` (no enum check)
- `EntityOnboardingModal.tsx` line 113: `const finalRole = sel.role === 'OTRO' ? (sel.userInput || '').trim().toUpperCase() : sel.role;` — ANY free text becomes the role when OTRO is selected

The canonical roles are defined in **2 places**:
1. `src/lib/constants/entity-roles.ts` — `ENTITY_ROLES` array + `entityRoleSchema` (z.enum) + `UI_ROLES` (excludes IGNORADA). **This is the source of truth.**
2. `rules/entity-roles.json` — same list, loaded by EntityOnboardingModal for the `<Select>` dropdown

**Affected routes that allow arbitrary roles:**
| Route | Schema | Allows arbitrary roles |
|-------|--------|----------------------|
| `POST /api/learning/entities` | `entityRoleSchema` | **No** — already validates |
| `POST /api/learning/context` | `entityContextSchema` | **Yes** — z.string().min(1).max(50) |
| `PATCH /api/entity-context/[id]` | None | **Yes** — no Zod at all |
| `POST /api/learning/classify-entity` | None | **Yes** — passes through classifyEntity() |

### Feature 2: Direction vs role mismatch warning

**Today:** Partial direction validation exists only in the **conversational-parse** flow:

- `POST /api/learning/conversational-parse/route.ts` (lines 66-108): After getting an AI parse result, it loads `direction-profiles.json` and checks if the suggested account's `normalBalance` conflicts with the transaction's direction profile.
- `direction-profiles.json` maps account type codes (1-6) to `{ normalBalance, deviationThreshold, allowOpposite }`
- This check only fires for the conversational AI flow — **NOT** when manually creating/editing entities via the management UI

**Missing pieces:**
- No explicit mapping of role → expected direction (e.g., CLIENTE/INGRESO → expects credits)
- `role-account-map.ts` has `debit`/`credit` codes per role but no "expected direction" property
- `entity-detector.ts` has `DirectionProfile` (`creditPct`, `debitPct`) on every `EntityCandidate`
- No warning/block in:
  - `EntityManagementPage.tsx` (edit dialog, create dialog)
  - `EntityOnboardingModal.tsx` 
  - Any of the backend API routes for create/update

### Feature 3: Split mixed entities (debit + credit) into 2

**Today:** No mechanism exists for splitting mixed entities.

- `EntityOnboardingModal` shows `directionLabel` per candidate (credit/debit/mixed) but no split option
- The modal creates 1 `EntityContext` per candidate with a single role
- `EntityContext` has a `roles` JSON field (stringified array) that could theoretically hold multiple roles, but this is never used for splitting
- The scan pipeline (`POST /api/ai-rules/scan/route.ts`) clusters transactions and produces enriched candidates with `directionProfile`, but each candidate maps to 1 `ScanPattern`
- `entity-enricher.ts` — `resolveDirection()` returns `debit` if `debitPct > 0.5`, `credit` if `creditPct > 0.5`, `null` if mixed; single direction per candidate only

### Feature 4: AI suggestion when user selects "OTRO"

**Today:** When the user selects "OTRO" in EntityOnboardingModal:
1. A free-text input appears
2. The user types any text
3. On save, `handleClassifyAll()` sets `finalRole = sel.userInput.trim().toUpperCase()` — the free text BECOMES the role stored in the database
4. No AI analysis of the free text occurs

**Existing AI infrastructure:**
- `parseWithAI()` in `conversational-service.ts`: Calls external chat API (`/chat/completions`) with system instruction from `assistant-config.json`. Returns `{ role, glAccountCode, conditions, suggestSubAccount, subAccountName }`.
- `parseConversationalContext()` in same file: Complete pipeline that collects signals from EntityContext + Heuristics + AI, runs `decision-engine.ts`, resolves GL account.
- `POST /api/learning/conversational-parse/route.ts`: Existing API endpoint that wraps `parseConversationalContext()`.
- AI config: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` env vars; model fallback for `openrouter/free`; 10s timeout; JSON response format.
- `assistant-config.json` systemInstruction is in Spanish, covers US GAAP accounting, includes all canonical roles in the prompt.
- The AI currently does NOT return "OTRO" — it returns one of the canonical roles.

---

## Affected Areas

### Files requiring changes

| File | Feature(s) | Reason |
|------|-----------|--------|
| `src/lib/validations/entity-context.ts` | F1 | Change `role: z.string().min(1).max(50)` to `entityRoleSchema` |
| `src/lib/services/entity-context-service.ts` | F1 | Uses `entityContextSchema` — validates automatically if schema changes |
| `src/app/api/entity-context/[id]/route.ts` | F1 | Add Zod validation for `role` field in PATCH handler |
| `src/app/api/learning/classify-entity/route.ts` | F1 | Add role validation before calling `classifyEntity()` |
| `src/app/api/learning/context/route.ts` | F1 | Already uses `entityContextSchema` — auto-fixed if schema changes |
| `src/lib/services/entity-context-crud-service.ts` | F1 | `updateEntityContext()` — could add validation layer |
| `src/lib/constants/role-account-map.ts` | F2 | Add `expectedDirection` field (`'credit' | 'debit' | 'mixed'`) per role |
| `src/lib/services/entity-enricher.ts` | F2, F3 | Add direction-mismatch detection, add split-entity logic |
| `src/lib/types/shared.ts` or new file | F2 | Define direction expectation type |
| `src/app/api/learning/conversational-parse/route.ts` | F2 | Already has direction check — could extract to shared util |
| `src/components/spa/EntityManagementPage.tsx` | F2 | Show direction/role mismatch warning in edit/create dialogs |
| `src/components/learning/EntityOnboardingModal.tsx` | F2, F3, F4 | Show mismatch warning, add split-entity UI, add AI suggestion toast |
| `src/app/api/learning/classify-entity/route.ts` | F4 | Could add AI analysis endpoint for OTRO suggestions |
| `src/lib/services/conversational-service.ts` | F4 | `parseWithAI` already exists — could expose lightweight variant |
| `rules/assistant-config.json` | F4 | System instruction might need minor tweaks for OTRO suggestions |

### Test files requiring updates

| File | Feature(s) | Reason |
|------|-----------|--------|
| `tests/services/entity-classifier.test.ts` | F1 | Tests currently use arbitrary role strings — need to use canonical roles |
| `tests/services/entity-enricher.test.ts` | F2, F3 | New test coverage for direction mismatch & split logic |

---

## Approaches

### Feature 1: Validate canonical roles on EntityContext save

**Approach 1a: Change entityContextSchema to use entityRoleSchema**
- Change `role: z.string().min(1).max(50)` → `role: entityRoleSchema` in `entity-context.ts`
- Add Zod validation to `PATCH /api/entity-context/[id]/route.ts`
- This instantly fixes `saveContext()`, `POST /api/learning/context`, and `POST /api/learning/entities`
- Pros: Minimal change (2 files), leverages existing `entityRoleSchema`, fixes most routes
- Cons: Breaking change — existing DB data with free-text roles would fail validation on update; OTRO flow stores free text as role — would break
- Effort: **Low**

**Approach 1b: Relaxed schema with OTRO allowance**
- Keep `entityRoleSchema` but also accept free text when role is explicitly "OTRO" (i.e., require OTRO to have a free text companion field)
- Or: Change DB schema to separate `role` (canonical enum) from `customRole` (free text, used only when role=OTRO)
- Pros: Handles OTRO gracefully, cleaner data model
- Cons: More migrations, more UI changes, higher effort
- Effort: **Medium**

**Recommended: Approach 1a** — but with a migration path:
1. First, fix the OTRO flow so free text goes to a different field or is stored as canonical "OTRO" plus descriptive text
2. Then change the schema to `entityRoleSchema`
3. For PATCH route, add a simple Zod schema with `entityRoleSchema`

### Feature 2: Direction vs role mismatch warning

**Approach 2a: Add expectedDirection to role-account-map.ts**
- Add `expectedDirection: 'credit' | 'debit' | 'mixed'` to each role in `ROLE_ACCOUNT_MAP`
- Create a shared validation function `checkRoleDirectionMismatch(role, directionProfile)` 
- Call it in entity creation/update flows (backend + frontend)
- Show warning in UI (yellow banner, non-blocking)
- Pros: Simple, single source of truth, reusable
- Cons: Adds another concern to `ROLE_ACCOUNT_MAP` (rename to reflect broader purpose?)
- Effort: **Low**

**Approach 2b: Extract direction-profiles to a role-level mapping**
- Create a new consolidated `role-direction-map.ts` that maps each role → expected direction
- Keep `direction-profiles.json` for account-type profiles
- Same validation function approach
- Pros: Cleaner separation of concerns
- Cons: Another file to maintain, more indirection
- Effort: **Low**

**Recommended: Approach 2a** — simplest, keeps everything in one place.

### Feature 3: Split mixed entities (debit + credit) into 2

**Approach 3a: Frontend-only split suggestion**
- In `EntityOnboardingModal`, detect mixed entities (`creditPct > 0.15 && debitPct > 0.15`)
- Show a "Split into 2 entities?" toggle/button
- When split: create 2 EntityContext records — one with appropriate debit role, one with credit role
- Use `resolveDirection()` logic to determine which role fits each side
- Pros: No backend changes, fast to implement
- Cons: User has to manually assign roles to each split; doesn't handle all edge cases
- Effort: **Medium**

**Approach 3b: Backend-driven split with AI suggestion**
- New endpoint or extended scan logic: for each mixed candidate, the backend proposes a split
- Each split entity gets its own role + GL account suggestion based on transaction analysis
- Frontend presents the proposals and user confirms/rejects
- Pros: Smarter suggestions, better UX
- Cons: More complex, more backend work
- Effort: **High**

**Recommended: Approach 3a** for MVP — simple UI toggle, manual role assignment per split entity. Can enhance to 3b later.

### Feature 4: AI suggestion when user selects "OTRO"

**Approach 4a: Client-side AI call on OTRO selection**
- When user selects OTRO and types a description, debounce and call `POST /api/learning/conversational-parse` with the description
- Parse the result and show a toast: "Did you mean SOCIO/PROVEEDOR/...?"
- User can click the toast to update the role selection
- Pros: Uses existing endpoint, minimal new code
- Cons: `conversational-parse` expects `directionProfile` — need to adapt
- Effort: **Low**

**Approach 4b: Lightweight dedicated AI endpoint**
- New `POST /api/learning/suggest-role` endpoint
- Takes `{ description: string }`, calls `parseWithAI()` directly (no signal pipeline)
- Returns `{ suggestedRole, confidence }` 
- Frontend polls after OTRO selection
- Pros: Simpler API contract, no directionProfile requirement
- Cons: New endpoint to maintain
- Effort: **Low**

**Recommended: Approach 4b** — cleaner API contract. The existing `conversational-parse` has too many dependencies (direction profile, signal pipeline). A lightweight endpoint would be more appropriate for this use case.

---

## Recommendation

| Feature | Approach | Effort | Priority |
|---------|----------|--------|----------|
| F1: Role validation | 1a — Change entityContextSchema + add PATCH validation | Low | **P0** (security/data integrity) |
| F2: Direction mismatch | 2a — Add expectedDirection + shared validator | Low | **P1** (user experience) |
| F3: Split mixed entities | 3a — Frontend split in EntityOnboardingModal | Medium | **P2** (enhancement) |
| F4: AI suggestion for OTRO | 4b — New lightweight suggest-role endpoint | Low | **P1** (user experience) |

**Order:** F1 → F2 → F4 → F3

F1 is the foundation — without it, arbitrary roles pollute the database. F2 and F4 are quick wins that improve UX. F3 is impactful but more complex.

---

## Risks

1. **OTRO backward compatibility** (F1): Current OTRO flow stores free text as the role value. Changing to enum validation means existing OTRO roles with custom text will fail on update. **Mitigation**: Migrate existing OTRO entries to canonical "OTRO" role before enforcing validation, or add a `customRole` field.

2. **Learnings flow duplication** (F4): There are multiple entity creation paths (EntityOnboardingModal, EntityManagementPage, conversational-parse, classify-entity). Each has slightly different flows. Need to ensure OTRO suggestion works consistently across all paths.

3. **Mixed entity edge cases** (F3): Some entities legitimately have both debits and credits but should remain as one entity (e.g., SOCIO with draws + capital contributions). The split should be optional, not automatic.

4. **AI cost/rate limiting** (F4): If OTRO suggestion fires an AI call every keystroke, it could get expensive. **Mitigation**: Debounce (500ms+), minimum text length (5+ chars), and possibly a daily limit per company.

5. **No test coverage for direction validation**: Existing tests don't cover direction-role mismatch. New tests needed.

---

## Ready for Proposal

**Yes** — with the following clarifications needed:

1. **OTRO handling**: Should we add a `customRole` field to the schema for OTRO's free text, or simply store canonical "OTRO" as the role and discard the free text? Current behavior stores free text AS the role, which is technically broken.
2. **Split UI depth**: Does the desired split UX need to be fully automatic (AI picks roles for each half) or manual (user picks roles for each half)?
3. **AI suggestion scope**: Should AI fire on every "OTRO" selection automatically, or only when the user explicitly clicks "Suggest"? This affects cost/UX tradeoff.
