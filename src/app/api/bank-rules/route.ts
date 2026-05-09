import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { verifyCompanyAccess } from '@/lib/verify-access';
import { computeAuditHash } from '@/lib/journal-hash';

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
    return NextResponse.json(
      { error: 'companyId is required' },
      { status: 400 }
    );
  }

  // Verify user has access to this company
  const access = await verifyCompanyAccess(userId, companyId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
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
    const {
      companyId,
      name,
      conditionType,
      conditionValue,
      transactionDirection = 'any',
      glAccountId,
      priority = 10,
      isActive = true,
    } = body;

    // Validate required fields
    if (!companyId || !name?.trim()) {
      return NextResponse.json(
        { error: 'companyId and name are required' },
        { status: 400 }
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
        { status: 400 }
      );
    }

    if (!conditionValue?.trim()) {
      return NextResponse.json(
        { error: 'conditionValue is required' },
        { status: 400 }
      );
    }

    const validDirections = ['any', 'debit', 'credit'];
    if (!validDirections.includes(transactionDirection)) {
      return NextResponse.json(
        { error: `transactionDirection must be one of: ${validDirections.join(', ')}` },
        { status: 400 }
      );
    }

    if (!glAccountId) {
      return NextResponse.json(
        { error: 'glAccountId is required' },
        { status: 400 }
      );
    }

    // Verify admin access
    const access = await verifyCompanyAccess(userId, companyId, 'admin');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Verify GL account exists in company
    const glAccount = await db.glAccount.findFirst({
      where: { id: glAccountId, companyId },
    });
    if (!glAccount) {
      return NextResponse.json(
        { error: 'GL account not found or does not belong to this company' },
        { status: 400 }
      );
    }

    // Validate amount conditions have numeric value
    if (
      (conditionType === 'amount_greater' || conditionType === 'amount_less') &&
      isNaN(Number(conditionValue))
    ) {
      return NextResponse.json(
        { error: 'conditionValue must be a number for amount conditions' },
        { status: 400 }
      );
    }

    // Validate priority range
    const p = typeof priority === 'number' ? Math.round(priority) : 10;
    if (p < 0 || p > 20) {
      return NextResponse.json(
        { error: 'priority must be between 0 and 20' },
        { status: 400 }
      );
    }

    const rule = await db.bankRule.create({
      data: {
        companyId,
        name: name.trim(),
        conditionType,
        conditionValue: conditionValue.trim(),
        transactionDirection,
        glAccountId,
        priority: p,
        isActive: Boolean(isActive),
      },
      include: {
        glAccount: {
          select: { id: true, code: true, name: true, accountType: true },
        },
      },
    });

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ ruleId: rule.id, name: rule.name, conditionType, conditionValue: rule.conditionValue, glAccountId, priority: p });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId, userId, action: 'create_bank_rule', entity: 'BankRule',
        entityId: rule.id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId, userId, action: 'create_bank_rule', entity: 'BankRule',
      entityId: rule.id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json(
      {
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
        _matchCount: 0,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[BANK RULE CREATE ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
