import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { apiHandler } from '@/lib/api-handler';
import { validateRequest } from '@/lib/validate-request';
import { createJournalEntrySchema } from '@/lib/validations/journal';
import { AuthError, ForbiddenError, ValidationError } from '@/lib/api-error';
import { JournalService } from '@/services/journal.service';

// ─── GET /api/journal ───────────────────────────────────────────────
// List journal entries for a company.
export const GET = apiHandler(async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    throw new AuthError();
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('companyId');
  const status = searchParams.get('status');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const search = searchParams.get('search');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20));

  if (!companyId) {
    throw new ValidationError('companyId is required');
  }

  // Verify user has access to this company
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) {
    throw new ForbiddenError();
  }

  // Build where clause
  const where: Record<string, unknown> = { companyId };

  if (status && status !== 'all') {
    where.status = status;
  }
  if (startDate || endDate) {
    where.date = {};
    if (startDate) (where.date as Record<string, unknown>).gte = new Date(startDate);
    if (endDate) (where.date as Record<string, unknown>).lte = new Date(endDate);
  }
  if (search) {
    where.description = { contains: search };
  }

  const [entries, total] = await Promise.all([
    db.journalEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        lines: {
          include: {
            glAccount: {
              select: { id: true, code: true, name: true },
            },
          },
        },
      },
    }),
    db.journalEntry.count({ where }),
  ]);

  // Calculate totals per entry
  const entriesWithTotals = entries.map((entry) => ({
    ...entry,
    date: entry.date.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    _totalDebit: entry.lines.reduce((sum, l) => sum + l.debit, 0),
    _totalCredit: entry.lines.reduce((sum, l) => sum + l.credit, 0),
  }));

  return NextResponse.json({
    data: entriesWithTotals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── POST /api/journal ──────────────────────────────────────────────
// Create a new journal entry with lines.
export const POST = apiHandler(async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    throw new AuthError();
  }

  const body = await validateRequest(request, createJournalEntrySchema);
  const { companyId } = body;

  // Verify user has access
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) {
    throw new ForbiddenError();
  }

  const entry = await JournalService.create(body);

  return NextResponse.json(
    {
      ...entry,
      date: entry.date.toISOString(),
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    },
    { status: 201 },
  );
});
