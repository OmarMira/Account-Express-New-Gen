# Spec: Entity Split

## Purpose

Allow users to split entities with mixed transaction directions into separate, direction-specific EntityContext records.

## Requirement: Detect Mixed Candidates

A candidate is "mixed" when `creditPct >= 0.15 && debitPct >= 0.15` in EntityOnboardingModal.

#### Scenario: Mixed entity shows split option

- GIVEN candidate with 60% credit / 40% debit
- WHEN rendered in EntityOnboardingModal
- THEN "Split into 2 entities?" button appears

#### Scenario: Dominant direction does not show split

- GIVEN candidate with 90% credit / 10% debit
- WHEN rendered
- THEN split button is hidden

## Requirement: Split Flow

On click:
1. User selects which direction to keep (credit or debit)
2. Creates EntityContext with `{ pattern, role, transactionDirection: selectedDirection }`
3. Other direction transactions remain unclassified

#### Scenario: Successful split

- GIVEN mixed candidate with pattern "OMAR MIRA"
- WHEN user splits keeping credits
- THEN EntityContext `{ pattern: "OMAR MIRA", transactionDirection: "credit" }` is created
- AND debit transactions stay unclassified

## Requirement: Re-scan Detection

On next scan, if EntityContext exists for pattern+direction AND unclassified opposite-direction transactions remain, prompt: "This pattern already exists for {direction}. Create a separate entity for remaining {other_direction} transactions?"
