# Tasks: Unify Form Styling

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 70–100 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: AdminCompaniesPage.tsx

- [x] 1.1 Search `<Input>` line 300 — strip className, keep only `pl-11`
- [x] 1.2 "Create" `<Button>` line 286 — replace with `variant="default"`, keep `self-start sm:self-center`
- [x] 1.3 10 `<Label>` elements (lines 451, 501, 513, 524, 536, 549, 582, 593, 604, 621) — remove className
- [x] 1.4 7 form `<Input>` elements (lines 504, 516, 527, 539, 585, 596, 624) — remove className
- [x] 1.5 Native `<select>` line 610 — change `rounded-xl` to `rounded-md` (rest is already standard)
- [x] 1.6 Checkbox `<input>` line 640 — remove className
- [x] 1.7 Checkbox `<Label>` line 642 — remove className
- [x] 1.8 "Cancel" ghost `<Button>` line 651 — remove className (keep ghost variant)
- [x] 1.9 "Save" submit `<Button>` line 659 — replace with `variant="default"`, no className
- [x] 1.10 Delete "Cancel" ghost `<Button>` line 687 — remove className (keep ghost)
- [x] 1.11 Delete confirm `<Button>` line 695 — replace with `variant="destructive"`, no className

## Phase 2: AdminUsersPage.tsx

- [x] 2.1 Search `<Input>` line 310 — strip className, keep only `pl-11`
- [x] 2.2 "Create" `<Button>` line 296 — replace with `variant="default"`, keep `self-start sm:self-center`
- [x] 2.3 12 `<Label>` elements (lines 448, 496, 508, 520, 533, 549, 565, 578, 611, 622, 633, 650, 672) — remove className
- [x] 2.4 7 form `<Input>` elements (lines 499, 511, 523, 538, 568, 614, 625, 653) — remove className (keep `pl-11` on password Input line 538)
- [x] 2.5 Native `<select>` role picker line 552 — replace with full standard Shadcn select classes
- [x] 2.6 Native `<select>` state picker line 636 — replace with full standard Shadcn select classes
- [x] 2.7 Checkbox `<input>` line 669 — remove className
- [x] 2.8 Checkbox `<Label>` line 671 — remove className
- [x] 2.9 "Cancel" ghost `<Button>` line 680 — remove className (keep ghost)
- [x] 2.10 "Save" submit `<Button>` line 688 — replace with `variant="default"`, no className
- [x] 2.11 Delete "Cancel" ghost `<Button>` line 719 — remove className (keep ghost)
- [x] 2.12 Delete confirm `<Button>` line 727 — replace with `variant="destructive"`, no className

## Phase 3: AdminCompanyDetailPage.tsx

- [x] 3.1 Error "Back" `<Button>` line 248 — replace with `variant="default"`, no className
- [x] 3.2 "Assign User" `<Button>` line 292 — replace with `variant="default"`, no className
- [x] 3.3 "Revoke" `<Button>` ghost/sm line 380 — replace with `variant="destructive" size="sm"`, no className
- [x] 3.4 `<Label>` select user line 421 — remove className
- [x] 3.5 Native `<select>` user picker line 424 — replace with full standard select classes
- [x] 3.6 `<Label>` role line 439 — remove className
- [x] 3.7 Native `<select>` role picker line 442 — replace with full standard select classes
- [x] 3.8 "Cancel" ghost `<Button>` line 453 — remove className (keep ghost)
- [x] 3.9 "Confirm" submit `<Button>` line 461 — replace with `variant="default"`, no className

## Phase 4: Smaller files

- [x] 4.1 `AdminAuditLogsPage.tsx` — strip Search `<Input>` className line 99, keep only `pl-11`
- [x] 4.2 `BanksPage.tsx` — replace "Upload Statement" `<Button>` line 308 with `variant="default"`, no className
- [x] 4.3 `ReconciliationPage.tsx` — replace "Upload Statement" `<Button>` line 795 with `variant="default"`, keep `gap-2`
- [x] 4.4 `FiscalPeriodsTab.tsx` — clean "Auto Generate" outline `<Button>` className line 341 (keep `variant="outline"`)
- [x] 4.5 `FiscalPeriodsTab.tsx` — replace "Generate" `<Button>` line 404 with `variant="default"`, no className
- [x] 4.6 `FiscalPeriodsTab.tsx` — clean "Year End Close" destructive `<Button>` className line 422 (keep `variant="destructive"`)
- [x] 4.7 `FiscalPeriodsTab.tsx` — replace "Execute Close" `<Button>` line 455 with `variant="destructive"`, no className

## Phase 5: Verification

- [x] 5.1 Run grep to confirm zero remaining custom class patterns in the 7 files
- [x] 5.2 Build project and confirm no TypeScript/compilation errors
- [x] 5.3 Run existing tests to confirm no regressions
