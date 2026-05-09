import { db } from '@/lib/db';

interface VerifyResult {
  ok: boolean;
  error?: string;
  membership?: {
    userId: string;
    companyId: string;
    role: string;
  };
}

const ADMIN_ROLES = ['company_admin', 'super_admin'];

/**
 * Verify that a user has an active membership in the specified company.
 * Optionally check that the user has a specific role.
 * Returns the membership if valid, or an error description.
 * Use this at the top of every write API before any database mutation.
 */
export async function verifyCompanyAccess(
  userId: string,
  companyId: string,
  requireRole?: string,
): Promise<VerifyResult> {
  if (!userId) {
    return { ok: false, error: 'Unauthorized' };
  }

  if (!companyId) {
    return { ok: false, error: 'companyId is required' };
  }

  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });

  if (!membership) {
    return { ok: false, error: 'Forbidden' };
  }

  if (requireRole) {
    if (requireRole === 'admin') {
      // Admin requires checking the User's global role
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user || !ADMIN_ROLES.includes(user.role)) {
        return { ok: false, error: 'Admin access required' };
      }
    } else if (membership.role !== requireRole) {
      return { ok: false, error: 'Insufficient permissions' };
    }
  }

  return {
    ok: true,
    membership: {
      userId: membership.userId,
      companyId: membership.companyId,
      role: membership.role,
    },
  };
}

/**
 * Helper to build a 403 response from verifyCompanyAccess.
 */
export function forbiddenResponse(error: string) {
  return { status: 403 as const, json: { error: string } };
}
