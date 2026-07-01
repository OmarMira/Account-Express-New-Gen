# Design: Human-Confirmed Smart Classification

## Technical Approach

Add a history-aware suggestion pipeline between entity detection and final classification: transactions -> detect entity -> aggregate entity history -> classify with context -> suggest role/intent/confidence -> human confirms -> learn and create safe rule. This change builds on, and should supersede as foundation, `entity-classification-workflow-state`: `role` remains nullable until confirmed, `classificationStatus` separates workflow from domain role, and no `BankRule`/accounting automation runs before confirmation.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Aggregation boundary | Create `entity-history-analyzer` service separate from `entity-detector` and `entity-classifier`. | Extend `clusterCandidates()` or `suggest-role` route. | Detection extracts identity; classification decides meaning. A dedicated analyzer keeps reusable history metrics testable. |
| Prompt construction | Build prompts from `EntityHistorySummary` fields and tenant/company data. | Hardcode examples or entity-specific wording. | Examples are illustrative only; production prompts must reflect actual entity history. |
| Confidence | Combine history sufficiency, direction purity, recurrence strength, prior confirmations, LLM confidence, and heuristic agreement. | Trust only LLM confidence. | Prevents cold-start overconfidence and makes confidence explainable. |
| Confirmation gate | Persist suggestions as pending/provisional; confirmed classifications are never auto-overwritten. | Auto-update context/rules on high confidence. | User confirmation is the safety boundary for accounting automation. |
| Legacy `OTRO` handling | Treat existing `EntityContext.role = 'OTRO'` as legacy uncertainty unless explicitly confirmed by the new workflow. | Keep `OTRO` as final or delete old contexts/rules. | Prior migration collapsed unknown roles into `OTRO`; preserving them as final would hide reclassification opportunities and deleting links would be unsafe. |

## Data Flow

```text
GET /api/learning/smart-classify
  -> load unreconciled/unclassified BankTransaction rows
  -> entity-detector extracts/clusters canonical entities
  -> entity-history-analyzer aggregates all matching company history
  -> smart-classification service runs heuristics + optional LLM prompt
  -> API returns suggestion, explanation, confidence, review question
  -> UI asks human confirmation
  -> POST /api/learning/classify-entity confirms context
  -> classifyEntity/saveContext may learn and create BankRule only if CONFIRMED
```

Cold start: entities below configured minimum occurrences/active months/recurrence strength can receive only low/medium provisional suggestions or a single review question. Re-evaluation runs whenever new transactions increase the history window; conflicting evidence creates an update suggestion, not an automatic overwrite.

Legacy `OTRO` flow: migration marks prior `OTRO` contexts as pending review (`role = null`, `classificationStatus = 'PENDING_REVIEW'`, or the equivalent workflow-state model). The first login or first visit to the learning/classification flow after deploy loads those pending contexts, aggregates existing transaction history, includes preserved `userDescription` in the prompt context, and surfaces enriched suggestions for human review.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/lib/services/entity-history-analyzer.ts` | Create | Query company transactions for a normalized entity and return aggregation summary. |
| `src/lib/services/smart-entity-classifier.ts` | Create | Orchestrate heuristics, LLM prompt, confidence, cold-start gates, and explanation. |
| `src/lib/services/entity-detector.ts` | Modify | Keep extraction/clustering focused; optionally expose normalized key helpers if needed. |
| `src/lib/services/entity-classifier.ts` | Modify | Accept confirmed suggestion metadata and enforce `CONFIRMED` + role + GL account before rule creation. |
| `src/app/api/learning/smart-classify/route.ts` | Modify | Replace raw cluster response with enriched human-confirmable suggestions. |
| `src/app/api/learning/suggest-role/route.ts` | Modify/possibly retire path | Reuse prompt/parsing logic or move shared LLM classification into service. |
| `src/components/learning/EntityOnboardingModal.tsx` | Modify carefully | Display suggestion, confidence, explanation, and confirmation/review question without disturbing dirty local work. |
| `prisma/schema.prisma` + migration | Modify/Create | If workflow-state is not already applied, add nullable role/status/confidence. Migrate legacy `OTRO` to pending review and preserve descriptions, linked accounts, and rule links for safe review. |
| `tests/services/*entity*`, `tests/api/learning/*` | Modify/Create | Unit and API coverage for aggregation, confidence, gates, and confirmation. |

## Interfaces / Contracts

```ts
type EntityHistorySummary = {
  entityKey: string;
  canonicalName: string;
  transactionCount: number;
  totalAmountAbs: number;
  activeMonths: number;
  directionProfile: { creditPct: number; debitPct: number; dominant: 'credit' | 'debit' | 'mixed' };
  averageIntervalDays: number | null;
  recurrenceLabel: 'weekly' | 'biweekly' | 'monthly' | 'sporadic' | 'one-time';
  amountStats: { min: number; max: number; average: number; median?: number };
  representativeDescriptions: string[];
  recentDescriptions: string[];
  priorConfirmations: Array<{ role: string | null; intent?: string | null; confirmedAt?: string }>;
  priorRules: Array<{ id: string; conditionValue: string; intent?: string | null }>;
  priorContext: { role: string | null; status?: string; confidence?: number | null } | null;
};

type SmartClassificationSuggestion = {
  suggestedRole: string | null;
  suggestedIntent: string | null;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  explanation: string;
  reviewQuestion?: string;
  requiresConfirmation: true;
  history: EntityHistorySummary;
};
```

Prompt builder contract: convert only populated summary fields into a compact context block, include allowed canonical roles/intents, direction semantics, recurrence and prior confirmation facts, and request strict JSON. Never embed example names, amounts, or hardcoded company-specific text.

Confidence should be a weighted/clamped score: history sufficiency, direction purity, recurrence strength, confirmed-context match, LLM confidence, and heuristic agreement increase confidence; mixed direction, sparse history, contradictory prior context, and LLM/heuristic disagreement reduce or cap it.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Aggregation metrics, recurrence labels, amount stats, prompt builder, confidence scoring | Vitest table tests with deterministic transaction fixtures. |
| Service | Cold-start gates, prior confirmation protection, conflict re-evaluation | Mock Prisma/LLM and assert no overwrite/no rule before confirmation. |
| API | `smart-classify` response shape and confirmation handoff | Extend learning API tests. |
| UI | Suggestions render as confirmable, not authoritative | Component tests around modal states. |

Strict TDD is active in config; implementation should use `bun x vitest --reporter=verbose --no-file-parallelism`.

## Migration / Rollout

Roll out in slices to stay near the 400-line review budget. Slice 1 should add analyzer + tests + API contract without UI/rule automation. Slice 2 wires classifier/confidence/LLM. Slice 3 updates modal and confirmation learning. If workflow-state migration is not merged first, include its nullable role/status/confidence migration before this change.

Legacy `OTRO` migration must be explicit and reversible: select existing `EntityContext.role = 'OTRO'`, set `role = null` and `classificationStatus = 'PENDING_REVIEW'` (or equivalent), preserve `userDescription`, `roles`, `pattern`, and audit timestamps, and record counts for rollback. Do not auto-create, activate, delete, or mutate `BankRule` records during migration. If an `OTRO` context has `glAccountId` or linked `BankRule` records, keep the links intact but mark the context/rule relationship as needs-review/inactive only if the current model already supports that state; otherwise surface the link in the review payload so the operator can confirm, replace, or leave it unchanged.

After deploy, the first login or first learning/classification visit should run or allow aggregation for pending legacy contexts using existing transaction history. The enriched suggestion prompt must include any preserved `userDescription` as user-provided context, but the resulting suggestion remains pending review. Reclassification must never overwrite a user-confirmed context and must never create or update BankRules until the operator confirms role, intent, and account.

## Risks

- The full change likely exceeds 400 changed lines; chained PRs are likely needed.
- LLM output can sound authoritative; UI and API must label suggestions as pending confirmation.
- Matching by normalized pattern can include false positives; summaries must expose representative/recent descriptions.
- Existing `suggest-role` caps LLM confidence at 0.69; new combined confidence must preserve the safety intent while allowing history-backed confidence.

## Open Questions

- [ ] Should suggestion history be persisted as fields on `EntityContext`, an audit log entry, or recomputed on demand for the first slice?
