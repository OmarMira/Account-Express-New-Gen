import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { logger } from '@/lib/logger';

// ─── GET /api/bank-rules ───────────────────────────────────────────
// List bank rules for a company, sorted by priority. Includes GL account info.
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('companyId');

  if (!companyId) {
    return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
  }

  // Verify user has access to this company
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rules = await db.bankRule.findMany({
    where: { companyId },
    orderBy: { priority: 'asc' },
    include: {
      glAccount: {
        select: { id: true, code: true, name: true, accountType: true },
      },
      _count: {
        select: { transactions: true },
      },
    },
  });

  const rulesWithCounts = rules.map((rule) => ({
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    _matchCount: rule._count.transactions,
  }));

  return NextResponse.json({ data: rulesWithCounts });
}

// ─── POST /api/bank-rules ──────────────────────────────────────────
// Create a new bank rule.
// Body: { companyId, name, conditionType, conditionValue, transactionDirection?, glAccountId, priority?, isActive? }
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    let {
      companyId,
      name,
      conditionType,
      conditionValue,
      transactionDirection,
      glAccountId,
      glAccountCode,
      priority = 10,
      isActive = true,
      directionProfile, // { creditPct, debitPct } — optional, sent by AI wizard
      conditions,
      debitGlAccountId,
      creditGlAccountId,
    } = body;

    // Validate required fields
    if (!companyId || !name?.trim()) {
      return NextResponse.json({ error: 'companyId and name are required' }, { status: 400 });
    }

    // Verify company access
    const membership = await db.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If conditions are provided, validate them. Otherwise fallback to legacy.
    if (conditions) {
      if (!Array.isArray(conditions) || conditions.length === 0) {
        return NextResponse.json(
          { error: 'conditions must be a non-empty array' },
          { status: 400 },
        );
      }
      for (const cond of conditions) {
        if (!cond.field || !['description', 'amount'].includes(cond.field.toLowerCase())) {
          return NextResponse.json(
            { error: "condition field must be 'description' or 'amount'" },
            { status: 400 },
          );
        }
        const validConditionTypes = [
          'contains',
          'starts_with',
          'ends_with',
          'equals',
          'amount_greater',
          'amount_less',
        ];
        if (!cond.operator || !validConditionTypes.includes(cond.operator)) {
          return NextResponse.json(
            { error: `condition operator must be one of: ${validConditionTypes.join(', ')}` },
            { status: 400 },
          );
        }
        if (!cond.value || !cond.value.trim()) {
          return NextResponse.json({ error: 'condition value cannot be empty' }, { status: 400 });
        }
        if (
          (cond.operator === 'amount_greater' || cond.operator === 'amount_less') &&
          isNaN(Number(cond.value))
        ) {
          return NextResponse.json(
            { error: 'condition value must be a number for amount conditions' },
            { status: 400 },
          );
        }
      }
    } else {
      // Legacy fallback
      if (!conditionType || !conditionValue) {
        return NextResponse.json(
          {
            error: 'Either conditions or legacy conditionType and conditionValue must be provided',
          },
          { status: 400 },
        );
      }
      const validConditionTypes = [
        'contains',
        'starts_with',
        'ends_with',
        'equals',
        'amount_greater',
        'amount_less',
      ];
      if (!validConditionTypes.includes(conditionType)) {
        return NextResponse.json(
          { error: `conditionType must be one of: ${validConditionTypes.join(', ')}` },
          { status: 400 },
        );
      }
      if (!conditionValue.trim()) {
        return NextResponse.json({ error: 'conditionValue cannot be empty' }, { status: 400 });
      }
      if (
        (conditionType === 'amount_greater' || conditionType === 'amount_less') &&
        isNaN(Number(conditionValue))
      ) {
        return NextResponse.json(
          { error: 'conditionValue must be a number for amount conditions' },
          { status: 400 },
        );
      }
      // Populate V2 conditions
      conditions = [
        {
          field: 'description',
          operator: conditionType,
          value: conditionValue.trim(),
        },
      ];
    }

    // Resolve direction
    if (!transactionDirection && directionProfile) {
      const isMixed = directionProfile.creditPct > 0.15 && directionProfile.debitPct > 0.15;
      transactionDirection = isMixed
        ? 'any'
        : directionProfile.creditPct > directionProfile.debitPct
          ? 'credit'
          : 'debit';
    }
    transactionDirection = transactionDirection ?? 'any';

    const validDirections = ['any', 'debit', 'credit'];
    if (!validDirections.includes(transactionDirection)) {
      return NextResponse.json(
        { error: `transactionDirection must be one of: ${validDirections.join(', ')}` },
        { status: 400 },
      );
    }

    // Resolve bifurcated account IDs from legacy fallback if not explicitly provided
    if (!debitGlAccountId && !creditGlAccountId) {
      if (!glAccountId && glAccountCode) {
        const dbAcc = await db.glAccount.findFirst({
          where: { code: String(glAccountCode), companyId },
        });
        if (dbAcc) {
          glAccountId = dbAcc.id;
        }
      }

      if (!glAccountId) {
        return NextResponse.json({ error: 'At least one GL Account is required' }, { status: 400 });
      }

      if (transactionDirection === 'debit') {
        debitGlAccountId = glAccountId;
      } else if (transactionDirection === 'credit') {
        creditGlAccountId = glAccountId;
      } else {
        debitGlAccountId = glAccountId;
        creditGlAccountId = glAccountId;
      }
    }

    // Validate GL Accounts existence and company matching
    if (debitGlAccountId) {
      const dbAcc = await db.glAccount.findFirst({
        where: { id: debitGlAccountId, companyId },
      });
      if (!dbAcc) {
        return NextResponse.json(
          { error: 'Debit GL account not found or forbidden' },
          { status: 400 },
        );
      }
    }
    if (creditGlAccountId) {
      const dbAcc = await db.glAccount.findFirst({
        where: { id: creditGlAccountId, companyId },
      });
      if (!dbAcc) {
        return NextResponse.json(
          { error: 'Credit GL account not found or forbidden' },
          { status: 400 },
        );
      }
    }

    // Validate priority range
    const p = typeof priority === 'number' ? Math.round(priority) : 10;
    if (p < 0 || p > 20) {
      return NextResponse.json({ error: 'priority must be between 0 and 20' }, { status: 400 });
    }

    const rule = await db.bankRule.create({
      data: {
        companyId,
        name: name.trim(),
        // V1 fields (for backwards compatibility)
        conditionType: conditionType || conditions[0].operator,
        conditionValue: conditionValue || conditions[0].value,
        transactionDirection,
        glAccountId: glAccountId || debitGlAccountId || creditGlAccountId || null,
        // V2 fields
        conditions: conditions,
        debitGlAccountId,
        creditGlAccountId,
        priority: p,
        isActive: Boolean(isActive),
      },
      include: {
        glAccount: {
          select: { id: true, code: true, name: true, accountType: true },
        },
        debitGlAccount: {
          select: { id: true, code: true, name: true, accountType: true },
        },
        creditGlAccount: {
          select: { id: true, code: true, name: true, accountType: true },
        },
      },
    });

    return NextResponse.json(
      {
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
        _matchCount: 0,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    logger.error('BANK_RULE_CREATE_ERROR', { error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
