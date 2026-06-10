import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { logger } from '@/lib/logger';
import { createAuditLogWithRetry } from '@/lib/audit';
import { validateDirectionProfile } from '@/lib/services/direction-validation';

// ─── GET /api/bank-rules ───────────────────────────────────────────
// List bank rules for a company, sorted by priority. Includes GL account info.
export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { companyId } = requireCompanyContext();
  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get('page');
  const limitParam = searchParams.get('limit');
  const hasPagination = pageParam !== null || limitParam !== null;

  if (hasPagination) {
    let page = parseInt(pageParam || '1', 10);
    let limit = parseInt(limitParam || '50', 10);
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500; // Cap at 500 to prevent abuse

    const total = await db.bankRule.count({
      where: { companyId },
    });

    const skip = (page - 1) * limit;
    const rules = await db.bankRule.findMany({
      where: { companyId },
      orderBy: { priority: 'asc' },
      skip,
      take: limit,
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

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      data: rulesWithCounts,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } else {
    const rules = await db.bankRule.findMany({
      where: { companyId },
      orderBy: { priority: 'asc' },
      take: 1000,
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
});

// ─── POST /api/bank-rules ──────────────────────────────────────────
// Create a new bank rule.
// Body: { companyId, name, conditionType, conditionValue, transactionDirection?, glAccountId, priority?, isActive? }
export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();

  try {
    const body = await request.json();
    let {
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
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
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

    // ─── Direction Profile Validation ────────────────────────────────
    // Verify that debit/credit GL accounts match their direction profiles
    try {
      await validateDirectionProfile(companyId, debitGlAccountId, creditGlAccountId);
    } catch (validationErr: unknown) {
      const validationMsg =
        validationErr instanceof Error
          ? validationErr.message
          : 'Direction profile validation failed';
      logger.warn('DIRECTION_PROFILE_VALIDATION_FAILED', {
        validationMsg,
        debitGlAccountId,
        creditGlAccountId,
      });
      return NextResponse.json({ error: validationMsg }, { status: 400 });
    }
    // ─────────────────────────────────────────────────────────────────

    // ─── Conflict detection ──────────────────────────────────────────
    // Fetch all active rules for this company to check for duplicates / overlaps
    const existingRules = await db.bankRule.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        name: true,
        transactionDirection: true,
        conditions: true,
        conditionType: true,
        conditionValue: true,
        priority: true,
      },
    });

    const warnings: { type: string; message: string }[] = [];

    // Normalise the incoming conditions to a comparable shape
    const normalise = (cond: { field: string; operator: string; value: string }) =>
      `${cond.field}|${cond.operator}|${String(cond.value).toLowerCase().trim()}`;

    const incomingNorm = conditions.map(normalise).sort().join('::');
    const incomingDir = transactionDirection; // already resolved above

    for (const existing of existingRules) {
      const existingConditions: Array<{ field: string; operator: string; value: string }> =
        Array.isArray(existing.conditions) && existing.conditions.length > 0
          ? (existing.conditions as any[])
          : [
              {
                field: 'description',
                operator: existing.conditionType,
                value: existing.conditionValue,
              },
            ];

      const existingNorm = existingConditions.map(normalise).sort().join('::');
      const existingDir = existing.transactionDirection;

      // Direction compatibility: 'any' is compatible with everything
      const dirCompatible =
        incomingDir === 'any' || existingDir === 'any' || incomingDir === existingDir;

      // Step 1 — Exact duplicate check (BLOCKING)
      if (incomingNorm === existingNorm && dirCompatible) {
        return NextResponse.json(
          {
            error: 'A rule with identical conditions and direction already exists.',
            conflictingRuleId: existing.id,
            conflictingRuleName: existing.name,
          },
          { status: 409 },
        );
      }

      // Step 2 — Partial overlap check (WARNING, non-blocking)
      // Only applies to description-based `contains` conditions
      if (dirCompatible) {
        const incomingContains = conditions
          .filter(
            (c: { field: string; operator: string; value: string }) =>
              c.field === 'description' && c.operator === 'contains',
          )
          .map((c: { value: string }) => String(c.value).toLowerCase().trim());

        const existingContains = existingConditions
          .filter((c) => c.field === 'description' && c.operator === 'contains')
          .map((c) => String(c.value).toLowerCase().trim());

        for (const inVal of incomingContains) {
          for (const exVal of existingContains) {
            // Overlap: existing value is a substring of the incoming value (broader pattern) AND higher priority
            if (exVal !== inVal && inVal.includes(exVal) && existing.priority <= p) {
              warnings.push({
                type: 'overlap',
                message: `This rule may be shadowed by rule '${existing.name}' (ID: ${existing.id}) which has a broader pattern and higher priority.`,
              });
            }
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────

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

    await createAuditLogWithRetry({
      companyId,
      userId,
      action: 'BANK_RULE_CREATED',
      entity: 'BankRule',
      entityId: rule.id,
      details: JSON.stringify({
        name: rule.name,
        conditionType,
        conditions,
        transactionDirection,
        priority: p,
      }),
    });

    const responseBody = {
      data: {
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
        _matchCount: 0,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    logger.error('BANK_RULE_CREATE_ERROR', { error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

// ─── DELETE /api/bank-rules ────────────────────────────────────────
// Bulk delete bank rules.
// Body: { ids: string[], companyId: string }
export const DELETE = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();

  try {
    const body = await request.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }

    // Delete matching rules in database
    const deleteResult = await db.bankRule.deleteMany({
      where: {
        id: { in: ids },
        companyId,
      },
    });

    // Record bulk deletion in audit logs
    await createAuditLogWithRetry({
      companyId,
      userId,
      action: 'BANK_RULES_BULK_DELETED',
      entity: 'BankRule',
      details: JSON.stringify({ count: deleteResult.count, ids }),
    });

    return NextResponse.json({ success: true, count: deleteResult.count });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    logger.error('BANK_RULES_BULK_DELETE_ERROR', { error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
