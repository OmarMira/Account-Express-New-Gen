import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { createAuditLogWithRetry } from '@/lib/audit';
import { createLearningRuleSchema } from '@/lib/validations/learning-rule';

export const POST = apiHandler(async (request: NextRequest, context: { params: any }) => {
  const { userId, companyId } = requireCompanyContext();

  const body = await request.json();
  const parsed = createLearningRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const {
      pattern,
      lockedDirection,
      glAccountCode,
      role,
      createSubAccount,
      subAccountName,
      // v2 parameters
      conditions,
      debitGlAccountId,
      creditGlAccountId,
      debitGlAccountCode,
      creditGlAccountCode,
    } = parsed.data;

    if (!pattern && (!conditions || !Array.isArray(conditions))) {
      return NextResponse.json(
        { error: 'companyId, and pattern or conditions are required' },
        { status: 400 },
      );
    }

    // Pre-resolve GL account IDs outside the transaction (read-only lookups)
    let resolvedDebitGlAccountId = debitGlAccountId || null;
    let resolvedCreditGlAccountId = creditGlAccountId || null;

    if (debitGlAccountCode) {
      const dbAcc = await db.glAccount.findFirst({
        where: { companyId, code: debitGlAccountCode, isActive: true },
      });
      if (dbAcc) resolvedDebitGlAccountId = dbAcc.id;
    }

    if (creditGlAccountCode) {
      const dbAcc = await db.glAccount.findFirst({
        where: { companyId, code: creditGlAccountCode, isActive: true },
      });
      if (dbAcc) resolvedCreditGlAccountId = dbAcc.id;
    }

    // Pre-resolve parent GL account for legacy path
    let parentAccount: {
      id: string;
      code: string;
      accountType: string;
      normalBalance: string;
    } | null = null;
    if (glAccountCode) {
      parentAccount = await db.glAccount.findFirst({
        where: { companyId, code: glAccountCode, isActive: true },
      });
      if (!parentAccount) {
        return NextResponse.json({ error: 'Parent GL Account not found' }, { status: 400 });
      }
    }

    // Pre-fetch siblings for sub-account code generation (read-only)
    let siblings: { code: string }[] = [];
    if (parentAccount && createSubAccount && subAccountName?.trim()) {
      siblings = await db.glAccount.findMany({
        where: { companyId, parentId: parentAccount.id },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
    }

    // ─── Single atomic transaction ────────────────────────────────────
    const rule = await db.$transaction(async (tx) => {
      let legacyGlAccountId: string | null = null;

      if (parentAccount) {
        let finalGlAccountId = parentAccount.id;

        if (createSubAccount && subAccountName?.trim()) {
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

          // Create new sub-account inside transaction — find free code if race
          while (
            await tx.glAccount.findUnique({
              where: { companyId_code: { companyId, code: nextCode } },
            })
          ) {
            const parts = nextCode.split('-');
            const suffixNum = parseInt(parts[parts.length - 1], 10) + 1;
            nextCode = `${parentAccount.code}-${suffixNum.toString().padStart(2, '0')}`;
          }
          const subAccount = await tx.glAccount.create({
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

        legacyGlAccountId = finalGlAccountId;

        // Apply 3-way mapping logic to set bifurcated accounts if not explicitly set
        if (!resolvedDebitGlAccountId && !resolvedCreditGlAccountId) {
          const direction = lockedDirection || 'any';
          if (direction === 'debit') {
            resolvedDebitGlAccountId = finalGlAccountId;
          } else if (direction === 'credit') {
            resolvedCreditGlAccountId = finalGlAccountId;
          } else {
            resolvedDebitGlAccountId = finalGlAccountId;
            resolvedCreditGlAccountId = finalGlAccountId;
          }
        }
      }

      const defaultConditionType = pattern ? 'contains' : conditions?.[0]?.operator || 'contains';
      const defaultConditionValue = pattern || conditions?.[0]?.value || '';

      // Create Bank Matching Rule inside transaction
      const newRule = await tx.bankRule.create({
        data: {
          companyId,
          name: body.name || `Regla Autogenerada: ${pattern || 'V2 Composite'}`,
          conditionType: defaultConditionType,
          conditionValue: defaultConditionValue,
          transactionDirection: lockedDirection || 'any',
          glAccountId: legacyGlAccountId,
          conditions: conditions || null,
          debitGlAccountId: resolvedDebitGlAccountId,
          creditGlAccountId: resolvedCreditGlAccountId,
          priority: body.priority || 10,
          isActive: true,
        },
      });

      // Upsert Entity Context inside transaction
      if (pattern && role && legacyGlAccountId) {
        await tx.entityContext.upsert({
          where: {
            companyId_pattern: {
              companyId,
              pattern,
            },
          },
          update: {
            role,
            glAccountId: legacyGlAccountId,
            source: 'user',
          },
          create: {
            companyId,
            pattern,
            role,
            glAccountId: legacyGlAccountId,
            source: 'user',
          },
        });
      }

      // Write Audit Log inside transaction — if this throws, everything rolls back
      await createAuditLogWithRetry(
        {
          companyId,
          userId,
          action: 'RULE_CREATED_WITH_CONTEXT',
          entity: 'BankRule',
          details: JSON.stringify({
            ruleId: newRule.id,
            pattern,
            lockedDirection,
            glAccountId: legacyGlAccountId,
            debitGlAccountId: resolvedDebitGlAccountId,
            creditGlAccountId: resolvedCreditGlAccountId,
            role,
            createSubAccount,
            subAccountName,
          }),
        },
        tx,
      );

      return newRule;
    });
    // ─────────────────────────────────────────────────────────────────

    return NextResponse.json({ success: true, data: rule });
  } catch (error: any) {
    console.error('[POST LEARNING RULE ERROR]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
});
