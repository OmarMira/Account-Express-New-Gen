/**
 * Money utilities for accounting — Integer Cents Architecture
 *
 * ALL monetary values in the database are stored as integers (cents).
 * This eliminates floating-point precision errors entirely.
 *
 * Conversion happens ONLY at the API boundary:
 *   - Request (frontend → API): toCents(dollars)
 *   - Response (API → frontend): toDollars(cents)
 *
 * Internal computations stay in cents — sums, differences, and comparisons
 * are all exact integer arithmetic. No rounding, no tolerance, no patches.
 */

/** Convert a dollar amount to cents for database storage. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Convert cents from the database to dollars for API responses. */
export function toDollars(cents: number): number {
  return cents / 100;
}

/**
 * Check whether total debits and credits are balanced.
 * With integer cents, this is an EXACT comparison — no tolerance needed.
 * Returns true only when debitCents === creditCents.
 */
export function isBalanced(debitCents: number, creditCents: number): boolean {
  return debitCents === creditCents;
}
