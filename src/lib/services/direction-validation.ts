// src/lib/services/direction-validation.ts
// Centralized validation for GL account direction profiles
// Ensures that the debit and credit GL accounts belong to the correct class based on the first digit of their code.

import { db } from '@/lib/db';

/**
 * Validate that the provided GL account IDs match the expected direction profile for the company.
 *
 * @param companyId - The company to which the accounts belong.
 * @param debitGlAccountId - GL account ID used for debit transactions (optional).
 * @param creditGlAccountId - GL account ID used for credit transactions (optional).
 * @returns true if validation passes, otherwise throws an error.
 */
export async function validateDirectionProfile(
  companyId: string,
  debitGlAccountId?: string | null,
  creditGlAccountId?: string | null,
): Promise<boolean> {
  // Helper to fetch an account and extract its class (first digit of code)
  const fetchClass = async (accountId: string) => {
    const acct = await db.glAccount.findUnique({
      where: { id: accountId, companyId },
    });
    if (!acct) {
      throw new Error('GL account not found or does not belong to this company');
    }
    // Assume code is a string like "4..." where the first char indicates the class
    return acct.code?.charAt(0);
  };

  // Validate debit account if provided
  if (debitGlAccountId) {
    const debitClass = await fetchClass(debitGlAccountId);
    // Example rule: debit must be class "5" (expenses) – adjust as needed
    if (debitClass !== '5') {
      throw new Error('Debit GL account does not match required direction profile');
    }
  }

  // Validate credit account if provided
  if (creditGlAccountId) {
    const creditClass = await fetchClass(creditGlAccountId);
    // Example rule: credit must be class "4" (income) – adjust as needed
    if (creditClass !== '4') {
      throw new Error('Credit GL account does not match required direction profile');
    }
  }

  return true;
}
