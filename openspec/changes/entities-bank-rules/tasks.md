# Tasks: entities-bank-rules ✅ COMPLETED

## Delivery Configuration

| Setting | Value |
|---------|-------|
| Strategy | Chained PRs (force-chained) |
| Chain strategy | feature-branch-chain |
| Tracker branch | `feat/entities-bank-rules` |
| Review budget | 400 lines max per PR |
| Work-unit commits | Each task = clean, reviewable commit |
| TDD Mode | Strict — write tests before implementation |

## Phase 1: Type Fixes & Tests ✅

| Task | Description | Status |
|------|-------------|--------|
| 1.1 | Add V2 fields to BankRule interface | ✅ Done |
| 1.2 | Add V2 fields to RuleForm interface and defaultForm | ✅ Done |
| 1.3 | Replace `as any` with `Prisma.EntityContextWhereInput` | ✅ Done |
| 1.4 | Remove `as any` cast from `listEntityContexts` | ✅ Done |
| 1.5 | Update mock rules with V2 fields | ✅ Done |
| 1.6 | V2 payload shape test (Test A) | ✅ Done |
| 1.7 | Direction mapping tests (B, C, D) | ✅ Done |
| 1.8 | API route conditions[] validation tests | ✅ Done |

## Phase 2: Smart-Classify Integration ✅

| Task | Description | Status |
|------|-------------|--------|
| 2.1 | Change GET URL from classify-entity to smart-classify | ✅ Done |
| 2.2 | Verify smart-classify response compatibility | ✅ Done |
| 2.3 | Create endpoint purpose documentation | ✅ Done |

## Phase 3: Wizard Cleanup ✅

| Task | Description | Status |
|------|-------------|--------|
| 3.1 | Import audit — no external wizard imports | ✅ Done |
| 3.2 | Delete wizard test files (8 files) | ✅ Done |
| 3.3 | Delete wizard service and store (2 files) | ✅ Done |
| 3.4 | Delete wizard components and barrel (6 files) | ✅ Done |
| 3.5 | Final smoke test | ✅ Done |

## Verification

```bash
npx vitest run --reporter=verbose   # All tests pass
npx tsc --noEmit                    # Zero type errors
```

## Review Workload Forecast

| Phase | Estimated Lines | Review Budget | Status |
|-------|----------------|---------------|--------|
| Phase 1: Type Fixes & Tests | ~120 | 400 lines ✅ | Within budget |
| Phase 2: Smart-Classify Integration | ~30 | 400 lines ✅ | Within budget |
| Phase 3: Wizard Cleanup | ~0 (deletions only) | 400 lines ✅ | Negative lines |
