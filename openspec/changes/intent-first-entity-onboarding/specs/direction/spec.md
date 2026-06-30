# Delta for Direction

## ADDED Requirements

### Requirement: Onboarding direction label uses normalized real stats

EntityOnboardingModal MUST render direction labels from real transaction direction statistics using normalized `0..1` ratios and shared direction thresholds. The UI MUST NOT compare normalized ratios to percentage integers such as `70`.

#### Scenario: Pure credit renders Income

- GIVEN an entity candidate has 12 positive/credit transactions and 0 negative/debit transactions
- AND its normalized profile is `creditPct=1`, `debitPct=0`
- WHEN the onboarding modal renders the direction label
- THEN the label MUST indicate Income/Credit direction
- AND it MUST NOT indicate Mixed

#### Scenario: Pure debit renders Expense

- GIVEN an entity candidate has `debitPct=1` and `creditPct=0`
- WHEN the onboarding modal renders the direction label
- THEN the label MUST indicate Expense/Debit direction
- AND it MUST NOT indicate Mixed

#### Scenario: Mixed profile renders Mixed

- GIVEN an entity candidate has both debit and credit ratios below the pure threshold
- WHEN the onboarding modal renders the direction label
- THEN the label MUST indicate Mixed
- AND split guidance may be shown according to existing split rules

#### Scenario: Threshold boundary is normalized

- GIVEN a candidate has `creditPct=0.8` and `debitPct=0.2`
- WHEN the direction label is computed
- THEN the pure credit threshold applies as normalized `0.8`
- AND no `> 70` comparison is used

### Requirement: Direction label uses database-backed candidate statistics

The displayed direction label MUST be based on the candidate's actual transaction stats from detection/classification data, not on inferred role labels alone.

#### Scenario: Role does not override real stats

- GIVEN a candidate has real stats that classify as credit/income
- AND the derived internal role would normally imply another direction
- WHEN the modal renders the direction label
- THEN the label follows the real stats
- AND any mismatch is handled as a non-blocking warning where applicable
