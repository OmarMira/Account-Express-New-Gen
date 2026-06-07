# Proposal: Fix Hardcoded Fallbacks & Enforce Multitenant Isolation

## Intent

Eliminate hardcoded accounting heuristic fallbacks and prevent cross-tenant security vulnerabilities by validating `companyId` membership and correcting regex extraction behaviors.

## Scope

### In Scope
- Correct keyword heuristic hierarchy in `conversational-service.ts` to prioritize specific roles (e.g. employee, partner) over generic transaction types.
- Fix regex lookahead truncating in `rules/entity-detection.json` and sanitize inputs correctly.
- Add strict tenancy membership validation for all AI assistant tools and learning feedback recording API endpoints.

### Out of Scope
- Altering the upstream LLM prompt structure or temperatures.
- UI design changes to the AI assistant drawer/chat interfaces.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `multi-tenant-isolation`: Ensure users can only query, modify, or record feedback for companies they actively belong to.
- `transaction-categorization-heuristics`: Prioritize specific account roles (`EMPLOYEE`, `TENANT`) over generic types (`EXPENSE`).

## Approach

1. **Heuristics**: Modify `localHeuristicParse` in `conversational-service.ts` to evaluate explicit roles before fallback generic descriptors.
2. **Regex Correction**: Amend lookahead rules in `entity-detection.json` to parse name structures correctly without relying on technical suffixes.
3. **Tenancy Guard**: Query `db.companyMember` in `ai-assistant/route.ts` and `learning/feedback/route.ts` to ensure session `userId` is authorized for `companyId` before execution.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/services/conversational-service.ts` | Modified | Fix prioritization ordering in `localHeuristicParse`. |
| `rules/entity-detection.json` | Modified | Correct regex extraction rules and sanitization patterns. |
| `src/app/api/learning/feedback/route.ts` | Modified | Verify user membership for recorded feedback `companyId`. |
| `src/app/api/ai-assistant/route.ts` | Modified | Enforce strict membership checks on `bodyCompanyId`. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legitimate multi-company users blocked | Low | Validate session against membership list instead of single active company. |
| Fallback regex fails to match edge cases | Medium | Run full suite `scripts/test-assistant-engine.ts` continuously. |

## Rollback Plan

Revert affected files via Git: `git checkout HEAD -- src/lib/services/conversational-service.ts rules/entity-detection.json src/app/api/learning/feedback/route.ts src/app/api/ai-assistant/route.ts`

## Dependencies

- None

## Success Criteria

- [ ] `bun run scripts/test-rbac-isolation.ts` and `bun run scripts/test-assistant-engine.ts` pass.
- [ ] Requests to `learning/feedback` or `ai-assistant` with unauthorized `companyId` fail with `403 Forbidden` / `401 Unauthorized`.
- [ ] Specific employee keyword descriptors resolve to code `6030` instead of `5000`.
