# Proposal: Improve Entity Classifier

## Intent

AI guesses from description alone, ignores direction data, never persists OTRO input, has no fallback when unsure. Target: 90%+ accuracy.

## Scope

| In Scope | Out of Scope |
|----------|-------------|
| Direction + samples + amounts in AI prompt | Detection engine consolidation (future) |
| Direction as HARD FILTER for impossible roles | Manual entity creation (already spec'd) |
| OTRO persistence on accept/save | Role source consolidation (already done) |
| Web search fallback when AI unsure | UI redesign of onboarding modal |
| Tests for updated flows | |

## Capabilities

| Type | Capability | Change |
|------|-----------|--------|
| Modified | `entity-classification` | Rich prompt + OTRO persistence + direction filter |
| Modified | `entity-role-suggestion` | Web search fallback |

## Approach

Three ordered layers:
1. **Hard filter**: Exclude roles where `EXPECTED_DIRECTION` contradicts dominant direction (>80% threshold). SOCIO/OTRO/IGNORADA bypass.
2. **Rich prompt**: Send direction, sample descriptions (≤3), avg amount, and user OTRO text. Direction is primary signal.
3. **Web fallback**: AI confidence < 0.5 or error → web search entity name + description. Capped at 0.7 confidence.

**OTRO persistence**: User accepts AI suggestion → save canonical role (not OTRO). User saves with OTRO + description → persist `{ pattern, role: "OTRO", userDescription }`.

## Affected Areas

| File | Change |
|------|--------|
| `suggest-role/route.ts` | Direction + samples in prompt; web search fallback |
| `classify-entity/route.ts` | OTRO persistence; save userDescription |
| `entity-classifier.ts` | OTRO save; candidates filter classified OTRO |
| `EntityOnboardingModal.tsx` | Pass directionProfile; OTRO save path |
| `prisma/schema.prisma` | Add optional `userDescription` |
| `entity-classifier.test.ts` | New: direction filter, OTRO persistence |
| `suggest-role.test.ts` | Extended: web fallback, rich prompt |

## Risks

| Risk | L | Mitigation |
|------|---|------------|
| Direction filter edge cases | Med | 80% threshold; `directionOverride` exists |
| Web search costs/rate limits | Med | Only on low-confidence; cache per session |
| PII to external APIs | Low | Sanitize before sending |
| Schema migration | Low | Optional field, no backfill |

## Rollback Plan

Revert schema + down migration, revert suggest-role prompt, revert modal direction profile.

## Dependencies

- Web search API key (check `process.env`)
- Prisma migration for `EntityContext.userDescription`

## Success Criteria

- [x] suggest-role prompt includes direction + samples + amounts
- [x] Roles contradicting dominant direction excluded from AI suggestions
- [x] OTRO entities persist to EntityContext on accepted suggestion or save with description
- [x] Web search called when AI confidence < 0.5 or errors
- [x] All existing tests pass; new tests cover direction filter, OTRO persistence, rich prompt
