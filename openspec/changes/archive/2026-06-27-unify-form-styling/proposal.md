# Proposal: Unify Form Styling

## Intent

Remove all custom hardcoded Tailwind class overrides from form elements (Inputs, Labels, Buttons, native selects, Checkboxes) across 7 admin and settings pages. Let Shadcn's default component variants provide consistent visual styling throughout the system. Pure visual refactor — zero behavior changes.

## Scope

### In Scope
- 7 files: strip custom className overrides from Input, Label, Button, native select, and Checkbox elements
- Apply standard Shadcn select classes to native `<select>` tags
- Let `<Button variant="default">` inherit `--app-primary` (teal)
- Accept Shadcn dark mode defaults (no custom dark: prefixes)

### Out of Scope
- Dialog containers and page-level backgrounds (AdminCompanyDetailPage's `bg-slate-900` stays)
- Behavior changes, new features, i18n text changes
- CompanyDataTab.tsx — already standard, no changes needed
- Snapshot/visual tests (project has none for these components)

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None.

> Pure visual refactor — no spec-level requirement changes.

## Approach

1. Edit each of the 7 affected files to remove custom className overrides
2. Replace native `<select>` custom classes with standard Shadcn select classes
3. Replace `<Button>` custom classes with `<Button variant="default">`
4. Remove custom Label, Input, and Checkbox classNames
5. Verify with grep that no custom patterns remain in form elements

## Affected Areas

| File | Impact | Elements Changed |
|------|--------|-----------------|
| `AdminCompaniesPage.tsx` | Modified | 8 Inputs, 10 Labels, 2 Buttons, 1 select, 1 Checkbox |
| `AdminUsersPage.tsx` | Modified | 10 Inputs, 12 Labels, 2 Buttons, 2 selects, 1 Checkbox |
| `AdminCompanyDetailPage.tsx` | Modified | 2 selects, 2 Labels, 1 Button |
| `AdminAuditLogsPage.tsx` | Modified | 1 Input |
| `BanksPage.tsx` | Modified | 1 Button |
| `ReconciliationPage.tsx` | Modified | 1 Button |
| `FiscalPeriodsTab.tsx` | Modified | 1 Button |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Missed custom class in one of 7 files | Low | grep all custom patterns after edits |
| Button color change from indigo to teal surprises users | Low | Approved decision; teal = app primary color |
| Native select visual inconsistency | Low | Same classes as CompanyDataTab (already approved) |

## Rollback Plan

Revert the single commit introducing the changes (`git revert <hash>`). All 7 files return to original custom classes. Zero data risk — pure visual change. If committed per-file, revert in logical batches. Tests provide regression safety.

## Dependencies

None.

## Success Criteria

- [ ] All 7 affected files have zero custom className overrides on Input, Label, Button, select, Checkbox elements
- [ ] Native `<select>` elements use standard Shadcn select classes (matching CompanyDataTab.tsx)
- [ ] All `<Button>` elements use `<Button variant="default">` without custom classes
- [ ] All existing project tests pass unchanged
- [ ] `rounded-xl`, `focus:ring-indigo-500`, `bg-indigo-600`, `shadow-lg shadow-indigo-500/20` produce zero grep hits from form elements
