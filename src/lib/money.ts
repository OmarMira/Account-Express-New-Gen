/**
 * Money rounding and balance-checking utilities for accounting.
 */

/** Round a number to exactly 2 decimal places (cents). */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Tolerance for debit/credit balance comparison. */
export const BALANCE_TOLERANCE = 0.005;

/** Check whether total debits and credits are balanced within tolerance. */
export function isBalanced(debit: number, credit: number): boolean {
  return Math.abs(debit - credit) < BALANCE_TOLERANCE;
}
