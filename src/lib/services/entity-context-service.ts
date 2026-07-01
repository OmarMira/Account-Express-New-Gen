import { db } from '@/lib/db';
import { entityContextSchema } from '@/lib/validations/entity-context';
import { normalizePattern } from '@/lib/services/pattern-normalizer';

export async function findContext(companyId: string, description: string) {
  const normalized = normalizePattern(description);
  const contexts = await db.entityContext.findMany({
    where: { companyId, role: { not: null }, classificationStatus: 'CONFIRMED' },
    include: { glAccount: true },
  });
  return contexts.find((ctx) => normalized.includes(ctx.pattern.toLowerCase())) || null;
}

export async function saveContext(data: {
  companyId: string;
  pattern: string;
  role: string | null;
  roles?: string[];
  glAccountId?: string | null;
  source?: 'user' | 'ai';
  userId?: string;
  transactionDirection?: string | null;
  userDescription?: string | null;
  classificationStatus?: 'UNCLASSIFIED' | 'PENDING_REVIEW' | 'CONFIRMED';
  classificationConfidence?: number | null;
}) {
  const normalized = normalizePattern(data.pattern);
  const normalizedRole = data.role ? data.role.toUpperCase() : null;
  const classificationStatus = data.classificationStatus ?? (normalizedRole ? 'CONFIRMED' : 'PENDING_REVIEW');
  const validated = entityContextSchema.parse({
    companyId: data.companyId,
    pattern: normalized,
    role: normalizedRole,
    glAccountId: data.glAccountId,
    transactionDirection: data.transactionDirection,
    classificationStatus,
    classificationConfidence: data.classificationConfidence ?? null,
  });

  const rolesJson = data.roles?.length
    ? JSON.stringify(data.roles.map((r) => r.toUpperCase()))
    : null;

  const context = await db.entityContext.upsert({
    where: {
      companyId_pattern: {
        companyId: validated.companyId,
        pattern: validated.pattern,
      },
    },
    update: {
      role: validated.role,
      roles: rolesJson,
      glAccountId: validated.glAccountId,
      source: data.source ?? 'user',
      transactionDirection: validated.transactionDirection ?? null,
      userDescription: data.userDescription ?? null,
      classificationStatus: validated.classificationStatus ?? classificationStatus,
      classificationConfidence: validated.classificationConfidence ?? null,
    },
    create: {
      companyId: validated.companyId,
      pattern: validated.pattern,
      role: validated.role,
      roles: rolesJson,
      glAccountId: validated.glAccountId,
      source: data.source ?? 'user',
      transactionDirection: validated.transactionDirection ?? null,
      userDescription: data.userDescription ?? null,
      classificationStatus: validated.classificationStatus ?? classificationStatus,
      classificationConfidence: validated.classificationConfidence ?? null,
    },
  });

  // Log in AuditLog if userId is provided
  if (data.userId) {
    await db.auditLog.create({
      data: {
        companyId: data.companyId,
        userId: data.userId,
        action: 'ENTITY_CONTEXT_ASSIGNED',
        entity: 'EntityContext',
        entityId: context.id,
        details: JSON.stringify({
          pattern: validated.pattern,
          role: validated.role,
          roles: data.roles,
          glAccountId: validated.glAccountId,
          classificationStatus: validated.classificationStatus ?? classificationStatus,
          classificationConfidence: validated.classificationConfidence ?? null,
          source: data.source ?? 'user',
        }),
      },
    });
  }

  return context;
}
