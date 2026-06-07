import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { validateRequest } from '@/lib/validate-request';
import { createJournalEntrySchema } from '@/lib/validations/journal';
import { JournalService } from '@/services/journal.service';

// ─── GET /api/journal ───────────────────────────────────────────────
// List journal entries for a company.
export const GET = apiHandler(async (request: NextRequest) => {
  const { userId, companyId } = requireCompanyContext();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const search = searchParams.get('search');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20));

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

  const cursor = searchParams.get('cursor');

  if (cursor) {
    // Cursor-based pagination (Infinito Scroll)
    const entries = await db.journalEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      cursor: { id: cursor },
      skip: 1, // Skip the cursor element itself
      include: {
        lines: {
          include: {
            glAccount: {
              select: { id: true, code: true, name: true },
            },
          },
        },
      },
    });

    const hasMore = entries.length > limit;
    if (hasMore) {
      entries.pop();
    }

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
      nextCursor: hasMore ? entries[entries.length - 1].id : null,
      hasMore,
    });
  } else if (searchParams.has('cursor')) {
    // Initial fetch for cursor-based pagination (no cursor value but parameter exists)
    const entries = await db.journalEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        lines: {
          include: {
            glAccount: {
              select: { id: true, code: true, name: true },
            },
          },
        },
      },
    });

    const hasMore = entries.length > limit;
    if (hasMore) {
      entries.pop();
    }

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
      nextCursor: hasMore ? entries[entries.length - 1].id : null,
      hasMore,
    });
  }

  // Fallback: Offset-based pagination
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
  const { userId, companyId } = requireCompanyContext();

  const body = await validateRequest(request, createJournalEntrySchema);
  if (body instanceof NextResponse) return body;

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
