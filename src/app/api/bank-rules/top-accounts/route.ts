import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';

// ─── GET /api/bank-rules/top-accounts?companyId=xxx ───────────────────────────
// Returns up to 8 most-used GL accounts across bank rules for this company.
// Response: { data: [{ code, name, accountType, useCount }] }
export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();
  const { searchParams } = new URL(request.url);

  // Aggregate rule counts per glAccountId (use the legacy glAccountId field as canonical reference)
  const grouped = await db.bankRule.groupBy({
    by: ['glAccountId'],
    where: {
      companyId,
      glAccountId: { not: null },
    },
    _count: { glAccountId: true },
    orderBy: { _count: { glAccountId: 'desc' } },
    take: 8,
  });

  if (grouped.length === 0) {
    return NextResponse.json({ data: [] });
  }

  // Fetch account details for the top IDs
  const accountIds = grouped.map((g) => g.glAccountId as string);
  const accounts = await db.glAccount.findMany({
    where: { id: { in: accountIds }, companyId, parentId: null },
    select: { id: true, code: true, name: true, accountType: true },
  });

  // Build a lookup map and merge with counts, preserving rank order
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const data = grouped
    .filter((g) => accountMap.has(g.glAccountId as string))
    .map((g) => {
      const acc = accountMap.get(g.glAccountId as string)!;
      return {
        code: acc.code,
        name: acc.name,
        accountType: acc.accountType,
        useCount: g._count.glAccountId,
      };
    });

  return NextResponse.json({ data });
});
