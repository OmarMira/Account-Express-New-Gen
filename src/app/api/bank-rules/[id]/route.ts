import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { verifyCompanyAccess } from '@/lib/verify-access';
import { computeAuditHash } from '@/lib/journal-hash';
import { toCents } from '@/lib/money';

// Helper: check if a transaction matches a rule
function transactionMatchesRule(
  tx: { description: string; amount: number },
  rule: {
    conditionType: string;
    conditionValue: string;
    transactionDirection: string;
  }
): boolean {
  // Check direction first
  if (rule.transactionDirection === 'debit' && tx.amount >= 0) return false;
  if (rule.transactionDirection === 'credit' && tx.amount < 0) return false;

  const desc = tx.description.toLowerCase();
  const val = rule.conditionValue.toLowerCase();

  switch (rule.conditionType) {
    case 'contains':
      return desc.includes(val);
    case 'starts_with':
      return desc.startsWith(val);
    case 'ends_with':
      return desc.endsWith(val);
    case 'equals':
      return desc === val;
    case 'amount_greater':
      return Math.abs(tx.amount) > toCents(Number(rule.conditionValue));
    case 'amount_less':
      return Math.abs(tx.amount) < toCents(Number(rule.conditionValue));
    default:
      return false;
  }
}

// ─── GET /api/bank-rules/[id] ──────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const rule = await db.bankRule.findUnique({
    where: { id },
    include: {
      glAccount: {
        select: { id: true, code: true, name: true, accountType: true },
      },
      _count: {
        select: { transactions: true },
      },
    },
  });

  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  // Verify user has access
  const access = await verifyCompanyAccess(userId, rule.companyId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  return NextResponse.json({
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    _matchCount: rule._count.transactions,
  });
}

// ─── PUT /api/bank-rules/[id] ──────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const {
      name,
      conditionType,
      conditionValue,
      transactionDirection,
      glAccountId,
      priority,
      isActive,
    } = body;

    // Find existing rule
    const existing = await db.bankRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Verify admin access
    const access = await verifyCompanyAccess(userId, existing.companyId, 'admin');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Validate fields if provided
    if (name !== undefined && !name.trim()) {
      return NextResponse.json(
        { error: 'name cannot be empty' },
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
    if (conditionType !== undefined && !validConditionTypes.includes(conditionType)) {
      return NextResponse.json(
        { error: `conditionType must be one of: ${validConditionTypes.join(', ')}` },
        { status: 400 }
      );
    }

    if (conditionValue !== undefined && !conditionValue.trim()) {
      return NextResponse.json(
        { error: 'conditionValue cannot be empty' },
        { status: 400 }
      );
    }

    if (glAccountId !== undefined) {
      const glAccount = await db.glAccount.findFirst({
        where: { id: glAccountId, companyId: existing.companyId },
      });
      if (!glAccount) {
        return NextResponse.json(
          { error: 'GL account not found or does not belong to this company' },
          { status: 400 }
        );
      }
    }

    if (priority !== undefined) {
      const p = Math.round(priority);
      if (p < 0 || p > 20) {
        return NextResponse.json(
          { error: 'priority must be between 0 and 20' },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (conditionType !== undefined) updateData.conditionType = conditionType;
    if (conditionValue !== undefined) updateData.conditionValue = conditionValue.trim();
    if (transactionDirection !== undefined) updateData.transactionDirection = transactionDirection;
    if (glAccountId !== undefined) updateData.glAccountId = glAccountId;
    if (priority !== undefined) updateData.priority = Math.round(priority);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const rule = await db.bankRule.update({
      where: { id },
      data: updateData,
      include: {
        glAccount: {
          select: { id: true, code: true, name: true, accountType: true },
        },
        _count: {
          select: { transactions: true },
        },
      },
    });

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ ruleId: id, changes: updateData });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId: existing.companyId, userId, action: 'update_bank_rule', entity: 'BankRule',
        entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId: existing.companyId, userId, action: 'update_bank_rule', entity: 'BankRule',
      entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({
      ...rule,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
      _matchCount: rule._count.transactions,
    });
  } catch (error) {
    console.error('[BANK RULE UPDATE ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/bank-rules/[id] ───────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = await db.bankRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Verify admin access
    const access = await verifyCompanyAccess(userId, existing.companyId, 'admin');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Clear matchedRuleId from transactions that reference this rule
    await db.bankTransaction.updateMany({
      where: { matchedRuleId: id },
      data: { matchedRuleId: null },
    });

    await db.bankRule.delete({ where: { id } });

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ ruleId: id, name: existing.name });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId: existing.companyId, userId, action: 'delete_bank_rule', entity: 'BankRule',
        entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId: existing.companyId, userId, action: 'delete_bank_rule', entity: 'BankRule',
      entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[BANK RULE DELETE ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── POST /api/bank-rules/[id] (action=apply) ──────────────────────
// Apply this single rule to all unmatched transactions.
// Body: { action: 'apply' }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { action } = body;

    if (action !== 'apply') {
      return NextResponse.json(
        { error: "Invalid action. Use 'apply'." },
        { status: 400 }
      );
    }

    const rule = await db.bankRule.findUnique({
      where: { id },
    });
    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    if (!rule.isActive) {
      return NextResponse.json(
        { error: 'Cannot apply an inactive rule' },
        { status: 400 }
      );
    }

    // Verify admin access
    const access = await verifyCompanyAccess(userId, rule.companyId, 'admin');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Find all unmatched transactions for this company (via statements)
    const companyStatements = await db.bankStatement.findMany({
      where: { companyId: rule.companyId },
      select: { id: true },
    });
    const statementIds = companyStatements.map((s) => s.id);

    const unmatchedTransactions = await db.bankTransaction.findMany({
      where: {
        statementId: { in: statementIds },
        isReconciled: false,
        matchedRuleId: null,
      },
    });

    // Match transactions in memory
    const matchedIds = unmatchedTransactions
      .filter((tx) => transactionMatchesRule(tx, rule))
      .map((tx) => tx.id);

    // Update matched transactions
    if (matchedIds.length > 0) {
      await db.bankTransaction.updateMany({
        where: { id: { in: matchedIds } },
        data: {
          glAccountId: rule.glAccountId,
          matchedRuleId: rule.id,
        },
      });
    }

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ ruleId: id, ruleName: rule.name, matchedCount: matchedIds.length });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId: rule.companyId, userId, action: 'apply_bank_rule', entity: 'BankRule',
        entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId: rule.companyId, userId, action: 'apply_bank_rule', entity: 'BankRule',
      entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({
      success: true,
      matched: matchedIds.length,
      total: unmatchedTransactions.length,
    });
  } catch (error) {
    console.error('[BANK RULE APPLY ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
