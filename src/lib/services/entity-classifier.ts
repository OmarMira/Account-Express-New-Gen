import { db } from '@/lib/db';
import { loadConfig, clusterCandidates, extractComponents } from '@/lib/services/entity-detector';
import { saveContext } from '@/lib/services/entity-context-service';
import { logger } from '@/lib/logger';
import type { EntityCandidate } from '@/lib/services/entity-detector';

export interface ClassifyEntityInput {
  companyId: string;
  pattern: string;
  role: string;
  roles?: string[];
  glAccountCode?: string;
  source?: 'user' | 'ai';
  userId?: string;
  transactionDirection?: string | null;
  userDescription?: string | null;
}

export async function classifyEntity(input: ClassifyEntityInput): Promise<void> {
  const { companyId, pattern, role, roles, glAccountCode, source, userId, transactionDirection, userDescription } = input;

  if (role === 'OTRO' && !userDescription) {
    throw new Error('userDescription is required when role is OTRO');
  }

  let glAccountId: string | null = null;
  if (glAccountCode) {
    const acc = await db.glAccount.findFirst({
      where: { companyId, code: glAccountCode, isActive: true },
    });
    if (acc) glAccountId = acc.id;
  }

  await saveContext({
    companyId,
    pattern,
    role,
    roles,
    glAccountId,
    source: source ?? 'user',
    userId,
    transactionDirection,
    userDescription,
  });

  logger.info('[ENTITY CLASSIFIED]', { companyId, pattern, role, roles });
}

export async function getEntityCandidates(companyId: string): Promise<EntityCandidate[]> {
  const bankAccounts = await db.bankAccount.findMany({
    where: { companyId, isActive: true },
    select: { id: true },
  });

  if (bankAccounts.length === 0) return [];

  const transactions = await db.bankTransaction.findMany({
    where: {
      statement: { bankAccountId: { in: bankAccounts.map((a) => a.id) } },
    },
    select: { description: true, amount: true, date: true, id: true },
    take: 2000,
  });

  if (transactions.length === 0) return [];

  const config = loadConfig();
  const raw = transactions.map((t) => ({
    description: t.description,
    amount: t.amount,
    date: t.date instanceof Date ? t.date.toISOString() : String(t.date),
    id: t.id,
  }));

  const candidates = clusterCandidates(raw, config);

  const existingContexts = await db.entityContext.findMany({
    where: { companyId },
    include: { glAccount: { select: { code: true } } },
  });
  const contextByPattern = new Map(existingContexts.map((c) => [c.pattern.toLowerCase(), c]));

  const rules = await db.bankRule.findMany({
    where: { companyId, isActive: true },
    select: { conditionValue: true, conditions: true },
  });

  return candidates
    .map((c) => {
      const patternLower = c.canonicalName.toLowerCase();
      const ctx = contextByPattern.get(patternLower);

      if (ctx) return null;

      const hasRule = rules.some((rule) => {
        if (rule.conditionValue && String(rule.conditionValue).toLowerCase().includes(patternLower))
          return true;
        if (Array.isArray(rule.conditions)) {
          return (rule.conditions as Array<{ value: unknown }>).some((cond) =>
            String(cond.value).toLowerCase().includes(patternLower),
          );
        }
        return false;
      });

      if (hasRule) return null;

      c.hasContext = false;
      c.contextRole = '';
      c.suggestedAccountId = undefined;
      c.suggestedAccountCode = undefined;

      return c;
    })
    .filter((c): c is EntityCandidate => c !== null);
}

export interface ConflictInfo {
  hasMerchant: boolean;
  hasSocioInIndn: boolean;
  merchantName: string | null;
  socioIndnName: string | null;
}

export function detectEntityConflict(
  description: string,
  knownSocioPatterns: string[],
): ConflictInfo {
  const config = loadConfig();
  const components = extractComponents(description, config);

  const hasMerchant = components.merchant !== null;
  const socioIndnName = components.indnName;

  const hasSocioInIndn =
    socioIndnName !== null &&
    knownSocioPatterns.some((p) => socioIndnName!.toLowerCase().includes(p.toLowerCase()));

  return {
    hasMerchant,
    hasSocioInIndn,
    merchantName: components.merchant,
    socioIndnName,
  };
}

export async function getKnownSocioPatterns(companyId: string): Promise<string[]> {
  const contexts = await db.entityContext.findMany({
    where: { companyId },
    select: { pattern: true, role: true, roles: true },
  });

  const patterns: string[] = [];
  for (const ctx of contexts) {
    const roles: string[] = ctx.roles ? JSON.parse(ctx.roles) : [ctx.role];
    if (roles.includes('SOCIO')) {
      patterns.push(ctx.pattern.toLowerCase());
    }
  }
  return patterns;
}
