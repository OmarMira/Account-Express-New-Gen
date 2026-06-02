import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { parseConversationalContext } from '@/lib/services/conversational-service';
import { safeAuditLog } from '@/lib/services/audit-service';
import { logger } from '@/lib/logger';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

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

    // ─── VALIDACIÓN: directionProfile obligatorio ───────────────────
    const directionProfile = body.directionProfile;
    if (
      !directionProfile ||
      typeof directionProfile.creditPct !== 'number' ||
      typeof directionProfile.debitPct !== 'number'
    ) {
      return NextResponse.json(
        {
          error:
            'directionProfile con creditPct/debitPct numérico es obligatorio para validación contable.',
        },
        { status: 400 },
      );
    }

    const membership = await db.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Ejecutar el parser (con userId para auditoría de respuesta IA externa)
    const result = await parseConversationalContext(companyId, pattern, userInput, userId);

    // ─── VALIDACIÓN CRÍTICA DE DIRECCIONALIDAD (EXTERNALIZADA) ───
    const creditPct = directionProfile.creditPct;
    const debitPct = directionProfile.debitPct;
    const suggestedAccountType = result.glAccountCode?.charAt(0);

    if (suggestedAccountType) {
      const profilePath = join(process.cwd(), 'rules/direction-profiles.json');
      let directionProfiles: Record<
        string,
        { normalBalance: 'credit' | 'debit'; deviationThreshold: number; allowOpposite?: boolean }
      > = {};
      try {
        if (existsSync(profilePath)) {
          directionProfiles = JSON.parse(readFileSync(profilePath, 'utf-8'));
        }
      } catch (fsErr) {
        logger.error('FS_ERROR_DIRECTION_PROFILES', { error: String(fsErr) });
      }

      const profile = directionProfiles[suggestedAccountType];
      const threshold = profile?.deviationThreshold ?? 0.9;
      const allowOpposite = profile?.allowOpposite ?? false;
      const isMixed = creditPct > 0.15 && debitPct > 0.15;

      // Only block if: entity is NOT mixed, opposite is not allowed,
      // AND the account's normal balance clearly contradicts the observed flow.
      if (!allowOpposite && !isMixed) {
        if (creditPct >= threshold && profile?.normalBalance === 'debit') {
          return NextResponse.json(
            {
              error:
                'La cuenta sugerida no es válida para transacciones de INGRESO. Ajuste el rol o seleccione una cuenta de tipo Ingreso/Pasivo.',
            },
            { status: 400 },
          );
        }

        if (debitPct >= threshold && profile?.normalBalance === 'credit') {
          return NextResponse.json(
            {
              error:
                'La cuenta sugerida no es válida para transacciones de GASTO. Ajuste el rol o seleccione una cuenta de tipo Gasto/Activo.',
            },
            { status: 400 },
          );
        }
      }

      // Warn (structured) when a mixed entity maps to Equity (class 3)
      if (isMixed && suggestedAccountType === '3') {
        logger.warn('MIXED_ENTITY_CLASSIFIED_AS_EQUITY', { pattern, creditPct, debitPct });
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
      logger.warn('AUDIT_LOG_FAILED', { error: String(auditErr) });
    }
    // ──────────────────────────────────────────────────────────────

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    logger.error('CONVERSATIONAL_PARSE_ROUTE_ERROR', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
