import { db } from '@/lib/db';
import { entityContextSchema } from '@/lib/validations/entity-context';

export function normalizePattern(desc: string): string {
  let cleaned = desc.toLowerCase().trim();

  // Remove common prefixes
  cleaned = cleaned.replace(/^(zelle\s+)?payment\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^(zelle\s+)?transfer\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^check\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^transfer\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^withdrawal\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^deposit\s+(to|from)\s+/g, '');

  // Raiser/Lyft/Online patterns
  cleaned = cleaned.replace(/^raiser\s+\d*\s*des:edi\s+paymnt\s+id:[\w\d-]+\s+indn:/g, '');
  cleaned = cleaned.replace(/^lyft\.com\s+des:lyft\s+[\d-]+\s+id:[\w\d-]+\s+indn:/g, '');
  cleaned = cleaned.replace(/^lyft\.com\s+des:lyft\s+id:[\w\d-]+\s+indn:/g, '');
  cleaned = cleaned.replace(/des:[\w\s\.-]+id:[\w\d-]+(indn:)?/g, '');
  cleaned = cleaned.replace(/indn:/g, '');

  // Remove common suffixes
  cleaned = cleaned.replace(/\s+conf#\s*[\w\d]+/g, '');
  cleaned = cleaned.replace(/\s+for\s+\"[^\"]+\"/g, '');
  cleaned = cleaned.replace(/;\s*conf#\s*[\w\d]+/g, '');

  return cleaned.trim();
}

export async function findContext(companyId: string, description: string) {
  const normalized = normalizePattern(description);

  // Find a match where the stored pattern is a substring of the normalized description
  // or they are identical.
  const context = await db.entityContext.findFirst({
    where: {
      companyId,
      pattern: {
        equals: normalized,
      },
    },
    include: {
      glAccount: true,
    },
  });

  return context;
}

export async function saveContext(data: {
  companyId: string;
  pattern: string;
  role: string;
  glAccountId?: string | null;
  source?: 'user' | 'ai';
  userId?: string;
}) {
  const normalized = normalizePattern(data.pattern);
  const validated = entityContextSchema.parse({
    companyId: data.companyId,
    pattern: normalized,
    role: data.role.toUpperCase(),
    glAccountId: data.glAccountId,
  });

  const context = await db.entityContext.upsert({
    where: {
      companyId_pattern: {
        companyId: validated.companyId,
        pattern: validated.pattern,
      },
    },
    update: {
      role: validated.role,
      glAccountId: validated.glAccountId,
      source: data.source ?? 'user',
    },
    create: {
      companyId: validated.companyId,
      pattern: validated.pattern,
      role: validated.role,
      glAccountId: validated.glAccountId,
      source: data.source ?? 'user',
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
          glAccountId: validated.glAccountId,
          source: data.source ?? 'user',
        }),
      },
    });
  }

  return context;
}
