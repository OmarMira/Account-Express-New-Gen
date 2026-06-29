# Technical Design: Unify Form Styling

## Architecture Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Native `<select>` stays native** — no migration to Shadcn `<Select>`. The seven affected files use native selects with consistent layout. Applying the same standard classes used in `CompanyDataTab.tsx` (line 579) gives visual consistency without a component swap that would add complexity. | Faster, less risk, fewer lines changed. |
| 2 | **Button variant mapping**: `bg-indigo-600` → `variant="default"` (teal/primary), `bg-rose-600` → `variant="destructive"` (rose/danger). Ghost buttons with rose-600 text also become `variant="destructive"`. | Direct mapping to Shadcn semantics. |
| 3 | **Dark mode acceptance**: remove all `dark:` custom prefixes. Default Shadcn dark mode classes (via `dark:` in the component definitions) handle dark appearance uniformly. User approved this. | Eliminates 30+ hardcoded dark variants. |

## Standard Select Classes (reference from `CompanyDataTab.tsx:579`)

```
flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-950
```

## Per-File Change Tables

### 1. AdminCompaniesPage.tsx

| Line(s) | Element | Current (custom parts) | Change To |
|---------|---------|----------------------|-----------|
| 296–300 | Search `<Input>` | `pl-11 rounded-xl bg-card border-input text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-indigo-500` | Keep only `pl-11` |
| 284–290 | "Create" `<Button>` | `bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-lg shadow-indigo-500/20 transition-all gap-2 self-start sm:self-center` | `variant="default"`, no className (keep `self-start sm:self-center` for flex layout) |
| 451, 501, 513, 524, 536, 549, 582, 593, 604, 621 | 8× `<Label>` | `text-muted-foreground text-xs font-semibold uppercase tracking-wider` | Remove className |
| 504, 516, 527, 539, 585, 596, 624 | 6× form `<Input>` | `bg-card border-input text-foreground placeholder-muted-foreground rounded-xl focus:ring-indigo-500` | Remove className |
| 607–610 | Native `<select>` (state) | `rounded-xl ...` (already standard except for `rounded-xl`) | Change `rounded-xl` → `rounded-md` |
| 640 | `<input type="checkbox">` | `size-4 rounded border-input bg-card text-indigo-600 focus:ring-indigo-500 cursor-pointer` | Remove className |
| 642–644 | Checkbox `<Label>` | `text-foreground/90 text-sm font-semibold select-none cursor-pointer` | Remove className |
| 651–658 | "Cancel" `<Button>` (ghost) | `text-slate-500 hover:text-foreground hover:bg-muted rounded-xl` | Remove className (keep ghost variant) |
| 659–665 | "Save" submit `<Button>` | `bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20` | `variant="default"`, no className |
| 687–694 | Delete "Cancel" `<Button>` (ghost) | `text-slate-500 hover:text-foreground hover:bg-muted rounded-xl` | Remove className (keep ghost) |
| 695–702 | Delete confirm `<Button>` | `bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/20` | `variant="destructive"`, no className |

### 2. AdminUsersPage.tsx

| Line(s) | Element | Current (custom parts) | Change To |
|---------|---------|----------------------|-----------|
| 306–310 | Search `<Input>` | `pl-11 rounded-xl bg-card border-input text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-indigo-500` | Keep only `pl-11` |
| 294–300 | "Create" `<Button>` | `bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-lg shadow-indigo-500/20 transition-all gap-2 self-start sm:self-center` | `variant="default"`, no className (keep `self-start sm:self-center`) |
| 448, 496, 508, 520, 533, 549, 565, 578, 611, 622, 633, 650, 672 | 12× `<Label>` | `text-slate-400 text-xs font-semibold uppercase tracking-wider` | Remove className (672 checkbox label: `text-slate-300 text-sm font-semibold select-none cursor-pointer`) |
| 499–504, 511–516, 523–529, 538–544, 568–572, 614–618, 625–629, 653–657 | 7× form `<Input>` | `bg-slate-950 border-white/10 text-white rounded-xl focus:ring-indigo-500` | Remove className (538 password: keep `pl-11`) |
| 552–556 | Native `<select>` (role) | `block w-full rounded-xl border border-white/10 bg-slate-950 text-white px-4 py-2 text-sm focus:ring-indigo-500 outline-none h-[38px]` | Full standard select classes |
| 636–639 | Native `<select>` (state) | `flex h-9 w-full rounded-xl border border-white/10 bg-slate-950 text-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50` | Full standard select classes |
| 669 | `<input type="checkbox">` | `size-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer` | Remove className |
| 680–687 | "Cancel" `<Button>` (ghost) | `text-slate-400 hover:text-white rounded-xl` | Remove className |
| 688–694 | "Save" submit `<Button>` | `bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20` | `variant="default"`, no className |
| 719–726 | Delete "Cancel" `<Button>` (ghost) | `text-slate-400 hover:text-white rounded-xl` | Remove className |
| 727–734 | Delete confirm `<Button>` | `bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/20` | `variant="destructive"`, no className |

### 3. AdminCompanyDetailPage.tsx

| Line(s) | Element | Current (custom parts) | Change To |
|---------|---------|----------------------|-----------|
| 248–253 | Error "Back" `<Button>` | `bg-indigo-600 hover:bg-indigo-700 text-white shadow-md` | `variant="default"`, no className |
| 292–298 | "Assign User" `<Button>` | `bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-lg shadow-indigo-500/20 gap-2` | `variant="default"`, no className |
| 380–393 | "Revoke" `<Button>` (ghost/sm) | `text-rose-600 hover:text-white hover:bg-rose-600 rounded-lg gap-1.5 transition-colors` | `variant="destructive" size="sm"`, no className |
| 421 | `<Label>` (select user) | `text-slate-400 text-xs font-semibold uppercase tracking-wider` | Remove className |
| 424–428 | Native `<select>` (user picker) | `block w-full rounded-xl border border-white/10 bg-slate-950 text-white px-4 py-2.5 text-sm focus:ring-indigo-500 outline-none cursor-pointer` | Full standard select classes |
| 439 | `<Label>` (role) | `text-slate-400 text-xs font-semibold uppercase tracking-wider` | Remove className |
| 442–446 | Native `<select>` (role picker) | `block w-full rounded-xl border border-white/10 bg-slate-950 text-white px-4 py-2.5 text-sm focus:ring-indigo-500 outline-none cursor-pointer` | Full standard select classes |
| 453–460 | "Cancel" `<Button>` (ghost) | `text-slate-400 hover:text-white rounded-xl` | Remove className |
| 461–467 | "Confirm" submit `<Button>` | `bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20` | `variant="default"`, no className |

### 4. AdminAuditLogsPage.tsx

| Line(s) | Element | Current (custom parts) | Change To |
|---------|---------|----------------------|-----------|
| 95–99 | Search `<Input>` | `pl-11 rounded-xl bg-card border-input text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-indigo-500` | Keep only `pl-11` |

### 5. BanksPage.tsx

| Line(s) | Element | Current (custom parts) | Change To |
|---------|---------|----------------------|-----------|
| 307–312 | "Upload Statement" `<Button>` | `bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 text-white border-none shadow-sm hover:shadow transition-all` | `variant="default"`, no className |

Line 313 "New Bank Account" `<Button>` already uses default variant with no className → no change.

### 6. ReconciliationPage.tsx

| Line(s) | Element | Current (custom parts) | Change To |
|---------|---------|----------------------|-----------|
| 792–799 | "Upload Statement" `<Button>` | `gap-2 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 text-white border-none shadow-sm hover:shadow transition-all` | `variant="default"`, no className (keep `gap-2`) |

All other Buttons (auto-match, reconcile, unreconcile, adjustment, approve, reject) use standard variants (`outline`, `ghost`, `default`) with minimal className. No change. Fine date inputs (`h-8 w-36`) and search Input (`pl-9 h-8`) are sizing/layout-only, not visual overrides → no change.

### 7. FiscalPeriodsTab.tsx

| Line(s) | Element | Current (custom parts) | Change To |
|---------|---------|----------------------|-----------|
| 338–345 | "Auto Generate" `<Button>` (outline) | `border-indigo-200 hover:border-indigo-300 dark:border-indigo-900/50` | Remove className (keep `variant="outline"`) |
| 404–411 | "Generate" `<Button>` | `bg-indigo-600 hover:bg-indigo-700` | `variant="default"`, no className |
| 419–425 | "Year End Close" `<Button>` (destructive) | `bg-amber-600 hover:bg-amber-700 text-white border-none` | Remove className (keep `variant="destructive"`) |
| 455–462 | "Execute Close" `<Button>` | `bg-amber-600 hover:bg-amber-700 text-white` | `variant="destructive"`, no className |

All `<Label>` and `<Input>` elements in this file already use no className → no change.

## Verification Strategy

After edits, run these grep checks:

```bash
# Should return zero hits from the 7 files (may match comments or data)
rg "bg-indigo-600|bg-rose-600|bg-slate-950|rounded-xl" src/components/spa/ --include '*.tsx'
rg "focus:ring-indigo-500" src/components/spa/ --include '*.tsx'
rg "shadow-lg shadow-indigo" src/components/spa/ --include '*.tsx'
```

Exceptions: `AdminCompaniesPage.tsx` Header icon `text-indigo-600` and card-level `hover:border-indigo-500/30` are NOT form elements — they are page structure and stay.

## Rollout

Single commit. File list: the 7 files above. Simple `git revert <hash>` for rollback.
