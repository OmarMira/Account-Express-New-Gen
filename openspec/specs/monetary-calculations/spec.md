# Delta Spec: Monetary Calculations (Decimal Refactoring)

## MODIFIED Requirements

- **Prisma Schema Field Types**: Convert the following 12 monetary and balance fields from `Float` to `Decimal` with `@db.Decimal(18, 2)`:
  - `BankAccount`: `balance`, `initialBalance`
  - `BankStatement`: `openingBalance`, `closingBalance`, `totalCredits`, `totalDebits`
  - `BankTransaction`: `amount`
  - `ReconciliationPeriod`: `statementBalance`, `bookBalance`, `difference`
  - `JournalLine`: `debit`, `credit`
- **Application Calculations**: All calculations, additions, subtractions, and comparisons of these 12 monetary fields in application code must be performed using decimal arithmetic (e.g., via `decimal.js` or `Prisma.Decimal` methods like `.plus()`, `.minus()`, `.equals()`) to eliminate floating-point rounding errors.
- **Data Presentation**: Conversion to standard JS floating point numbers via `.toNumber()` is performed for UI display, serialization, or compatibility with components expecting native `number` types.

## Scenarios

### Scenario 1: Precision Arithmetic on Financial Entries
Given a transaction is processed with decimal values
When calculating the journal entry balance (sum of debits minus sum of credits)
Then the calculations are performed using Decimal arithmetic
And the difference is exact without floating-point rounding errors

### Scenario 2: Formatting and Displaying Monetary Values
Given a database query returns a `BankAccount` record
When the balance is read for display in the client UI
Then the `Decimal` balance is converted to a native JS `number` using `.toNumber()`
And formatted correctly as a currency string
