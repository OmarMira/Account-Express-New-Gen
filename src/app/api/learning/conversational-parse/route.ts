import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { parseConversationalContext } from '@/lib/services/conversational-service';

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

    // ─── FIX: Proteger el AuditLog para evitar fallos fatales ───
    try {
      await db.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'CONVERSATIONAL_CONTEXT_PARSED',
          entity: 'EntityContext',
          details: JSON.stringify({
            pattern,
            userInput,
            parsedRole: result.role,
            parsedGlAccountCode: result.glAccountCode,
            suggestSubAccount: result.suggestSubAccount,
          }),
        },
      });
    } catch (auditErr) {
      // Si falla el log, no detenemos la respuesta al usuario
      console.warn('[AUDIT LOG FAILED]', auditErr);
    }
    // ──────────────────────────────────────────────────────────────

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[CONVERSATIONAL PARSE ROUTE ERROR]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
