import { db } from '@/lib/db';

/**
 * Check if a date falls within a locked fiscal period for a company.
 * Returns true if the date is in a locked period (should be blocked).
 */
export async function isDateInLockedPeriod(
  companyId: string,
  date: Date,
): Promise<boolean> {
  const lockedPeriod = await db.fiscalPeriod.findFirst({
    where: {
      companyId,
      isLocked: true,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });
  return !!lockedPeriod;
}

/**
 * Get the locked period name if a date is locked, or null if allowed.
 */
export async function getLockedPeriodName(
  companyId: string,
  date: Date,
): Promise<string | null> {
  const lockedPeriod = await db.fiscalPeriod.findFirst({
    where: {
      companyId,
      isLocked: true,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { name: true },
  });
  return lockedPeriod?.name ?? null;
}
