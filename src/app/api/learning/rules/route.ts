import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      companyId,
      pattern,
      lockedDirection,
      glAccountCode,
      role,
      createSubAccount,
      subAccountName,
    } = body;

    if (!companyId || !pattern || !glAccountCode || !role) {
      return NextResponse.json(
        { error: 'companyId, pattern, glAccountCode, and role are required' },
        { status: 400 },
      );
    }

    // Verify access
    const membership = await db.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Find parent account
    const parentAccount = await db.glAccount.findFirst({
      where: { companyId, code: glAccountCode, isActive: true },
    });
    if (!parentAccount) {
      return NextResponse.json({ error: 'Parent GL Account not found' }, { status: 400 });
    }

    let finalGlAccountId = parentAccount.id;

    if (createSubAccount && subAccountName?.trim()) {
      // Find children under this parent to compute next code suffix
      const siblings = await db.glAccount.findMany({
        where: { companyId, parentId: parentAccount.id },
        orderBy: { code: 'desc' },
      });

      let nextCode = `${parentAccount.code}-01`;
      if (siblings.length > 0) {
        const lastCode = siblings[0].code;
        const parts = lastCode.split('-');
        if (parts.length > 1) {
          const suffixNum = parseInt(parts[parts.length - 1], 10) + 1;
          const suffixStr = suffixNum.toString().padStart(2, '0');
          nextCode = `${parentAccount.code}-${suffixStr}`;
        }
      }

      // Create new sub-account
      const subAccount = await db.glAccount.create({
        data: {
          companyId,
          code: nextCode,
          name: subAccountName.trim(),
          accountType: parentAccount.accountType,
          normalBalance: parentAccount.normalBalance,
          parentId: parentAccount.id,
          isActive: true,
        },
      });
      finalGlAccountId = subAccount.id;
    }

    // Create Bank Matching Rule
    const rule = await db.bankRule.create({
      data: {
        companyId,
        name: `Regla Autogenerada: ${pattern}`,
        conditionType: 'contains',
        conditionValue: pattern,
        transactionDirection: lockedDirection || 'any',
        glAccountId: finalGlAccountId,
        priority: 10,
        isActive: true,
      },
    });

    // Upsert Entity Context
    await db.entityContext.upsert({
      where: {
        companyId_pattern: {
          companyId,
          pattern,
        },
      },
      update: {
        role,
        glAccountId: finalGlAccountId,
        source: 'user',
      },
      create: {
        companyId,
        pattern,
        role,
        glAccountId: finalGlAccountId,
        source: 'user',
      },
    });

    // Write Audit Log
    await db.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'RULE_CREATED_WITH_CONTEXT',
        entity: 'BankRule',
        details: JSON.stringify({
          ruleId: rule.id,
          pattern,
          lockedDirection,
          glAccountId: finalGlAccountId,
          role,
          createSubAccount,
          subAccountName,
        }),
      },
    });

    return NextResponse.json({ success: true, data: rule });
  } catch (error: any) {
    console.error('[POST LEARNING RULE ERROR]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
