import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { parseConversationalContext } from '@/lib/services/conversational-service';
import { safeAuditLog } from '@/lib/services/audit-service';

// ── POST /api/learning/conversational-parse ──────────────────────
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const companyId = body.companyId;
    const pattern = body.pattern;
    const userInput = (body.userInput || body.userAnswer)?.trim();

    if (!companyId || !pattern || !userInput) {
      return NextResponse.json(
        { error: 'companyId, pattern, and userInput/userAnswer are required' },
        { status: 400 },
      );
    }

    const membership = await db.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Ejecutar el parser
    const result = await parseConversationalContext(companyId, pattern, userInput);

    // ─── VALIDACIÓN CRÍTICA DE DIRECCIONALIDAD ───
    const directionProfile = body.directionProfile || { creditPct: 0, debitPct: 0 };
    const creditPct = directionProfile.creditPct ?? 0;
    const debitPct = directionProfile.debitPct ?? 0;
    const suggestedAccountType = result.glAccountCode?.charAt(0);

    if (suggestedAccountType) {
      // Si es >90% Crédito, debe ser Ingreso (4), Pasivo (2) o Patrimonio (3)
      if (creditPct >= 0.9 && !['4', '2', '3'].includes(suggestedAccountType)) {
        return NextResponse.json(
          {
            error:
              'La cuenta sugerida no es válida para transacciones de INGRESO. Intente con una cuenta de tipo Ingreso o Pasivo.',
          },
          { status: 400 },
        );
      }

      // Si es >90% Débito, debe ser Gasto (5/6), Activo (1) o Patrimonio (3)
      if (debitPct >= 0.9 && !['5', '6', '1', '3'].includes(suggestedAccountType)) {
        return NextResponse.json(
          {
            error:
              'La cuenta sugerida no es válida para transacciones de GASTO. Intente con una cuenta de tipo Gasto o Activo.',
          },
          { status: 400 },
        );
      }

      // Si es Mixto y sugiere Equity (3), advertir pero permitir
      if (creditPct > 0.2 && debitPct > 0.2 && suggestedAccountType === '3') {
        console.warn(`⚠️ Entidad MIXTA clasificada como Equity: ${pattern}`);
      }
    }

    // ─── FIX: Proteger el AuditLog usando el servicio seguro ───
    try {
      await safeAuditLog({
        companyId,
        userId,
        action: 'CONVERSATIONAL_CONTEXT_PARSED',
        entity: 'EntityContext',
        details: {
          pattern,
          userInput,
          parsedRole: result.role,
          parsedGlAccountCode: result.glAccountCode,
          suggestSubAccount: result.suggestSubAccount,
        },
      });
    } catch (auditErr) {
      console.warn('[AUDIT LOG FAILED]', auditErr);
    }
    // ──────────────────────────────────────────────────────────────

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[CONVERSATIONAL PARSE ROUTE ERROR]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
