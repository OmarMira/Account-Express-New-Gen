import { NextRequest, NextResponse } from 'next/server';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { classifyEntity, getEntityCandidates } from '@/lib/services/entity-classifier';
import { parseConversationalContext } from '@/lib/services/conversational-service';
import { safeAuditLog } from '@/lib/services/audit-service';
import { entityRoleSchema } from '@/lib/constants/entity-roles';
import { logger } from '@/lib/logger';
import { serverT } from '@/lib/server-i18n';

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();
  const locale = request.headers.get('x-locale') ?? 'en';

  try {
    const body = await request.json();
    const { pattern, userInput, glAccountCode, role, transactionDirection, directionOverride } = body;

    if (!pattern) {
      return NextResponse.json(
        { error: serverT(locale, 'learning.patternRequired') },
        { status: 400 },
      );
    }

    // Log direction override for audit trail
    if (directionOverride) {
      logger.warn('[DIRECTION OVERRIDE]', { pattern, role, userId });
    }

    let finalRole = role;
    let finalGlAccountCode = glAccountCode;

    if (!finalRole) {
      // Fallback AI inference for conversational flow
      const parseResult = await parseConversationalContext(
        companyId,
        pattern,
        userInput || pattern,
        userId,
        undefined,
        undefined,
        undefined,
        locale,
      );
      finalRole = parseResult.role;
      finalGlAccountCode = finalGlAccountCode || parseResult.glAccountCode;
    }

    // Validate role against canonical entity roles before persisting
    if (finalRole) {
      const roleResult = entityRoleSchema.safeParse(finalRole);
      if (!roleResult.success) {
        return NextResponse.json(
          {
            error: 'Invalid role',
            details: roleResult.error.flatten(),
            validRoles: entityRoleSchema.options,
          },
          { status: 400 },
        );
      }
    }

    await classifyEntity({
      companyId,
      pattern,
      role: finalRole,
      roles: [finalRole],
      glAccountCode: finalGlAccountCode || undefined,
      source: 'user',
      userId,
      transactionDirection: transactionDirection ?? undefined,
    });

    await safeAuditLog({
      companyId,
      userId,
      action: 'ENTITY_CLASSIFIED',
      entity: 'EntityContext',
      details: {
        pattern,
        role: finalRole,
        glAccountCode: finalGlAccountCode || null,
        directionOverride: directionOverride || undefined,
      },
    });

    return NextResponse.json({
      success: true,
      data: { role: finalRole },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : serverT(locale, 'learning.serverError');
    logger.error('[CLASSIFY ENTITY ERROR]', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();
  const locale = request.headers.get('x-locale') ?? 'en';

  try {
    const candidates = await getEntityCandidates(companyId);

    await safeAuditLog({
      companyId,
      userId,
      action: 'ENTITY_CANDIDATES_FETCHED',
      entity: 'EntityContext',
      details: { count: candidates.length },
    });

    return NextResponse.json({ success: true, data: candidates });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : serverT(locale, 'learning.serverError');
    logger.error('[ENTITY CANDIDATES ERROR]', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
