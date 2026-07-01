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

// ─── autoCreateRule ────────────────────────────────────────────────────
//
// Creates or updates a BankRule for a confirmed EntityContext.
//
// CONFIRMATION GATE: All three conditions must be met before any rule is
// created or mutated:
//   1. classificationStatus === 'CONFIRMED'
//   2. non-null role
//   3. non-null glAccountId
//
// If any condition is unmet, returns { warning } without touching rules.

export interface AutoCreateRuleInput {
  companyId: string;
  pattern: string;
  classificationStatus: string;
  role: string | null;
  glAccountId: string | null;
  transactionDirection?: string | null;
  intent?: string | null;
  entityContextId?: string;
}

export interface AutoCreateRuleResult {
  created?: boolean;
  reactivated?: boolean;
  skipped?: boolean;
  warning?: string;
  ruleId?: string;
}

export async function autoCreateRule(
  input: AutoCreateRuleInput,
): Promise<AutoCreateRuleResult> {
  const { companyId, pattern, classificationStatus, role, glAccountId, transactionDirection, intent, entityContextId } = input;

  // ── Confirmation gate ─────────────────────────────────────────────
  if (classificationStatus !== 'CONFIRMED') {
    return {
      warning: `autoCreateRule skipped: classificationStatus is '${classificationStatus}', not 'CONFIRMED'`,
    };
  }

  if (!role) {
    return {
      warning: 'autoCreateRule skipped: role is null',
    };
  }

  if (!glAccountId) {
    return {
      warning: 'autoCreateRule skipped: glAccountId is null',
    };
  }

  // Verify the GL account exists
  const glAccount = await db.glAccount.findFirst({
    where: { id: glAccountId, companyId, isActive: true },
  });

  if (!glAccount) {
    logger.warn('[AUTO_CREATE_RULE] GL account not found or inactive', {
      glAccountId,
      companyId,
    });
    return {
      warning: `GL account '${glAccountId}' not found or inactive — EntityContext persisted, no rule created`,
    };
  }

  // ── Dedup by entityContextId ──────────────────────────────────────
  if (entityContextId) {
    const existing = await db.bankRule.findFirst({
      where: { companyId, entityContextId },
    });

    if (existing) {
      if (existing.isActive) {
        // Active rule already exists for this EntityContext → skip
        logger.info('[AUTO_CREATE_RULE] Active rule already exists', {
          ruleId: existing.id,
          entityContextId,
        });
        return { skipped: true, ruleId: existing.id };
      }

      // Inactive rule → reactivate and update from confirmed values
      const updated = await db.bankRule.update({
        where: { id: existing.id },
        data: {
          conditionValue: pattern,
          glAccountId,
          transactionDirection: transactionDirection ?? 'any',
          isActive: true,
          intent: (intent as any) ?? null,
        },
      });

      logger.info('[AUTO_CREATE_RULE] Reactivated existing rule', {
        ruleId: updated.id,
        entityContextId,
      });
      return { reactivated: true, ruleId: updated.id };
    }
  }

  // ── Create a new rule ─────────────────────────────────────────────
  const rule = await db.bankRule.create({
    data: {
      companyId,
      name: pattern,
      conditionType: 'contains',
      conditionValue: pattern,
      glAccountId,
      transactionDirection: transactionDirection ?? 'any',
      priority: 5,
      isActive: true,
      entityContextId: entityContextId ?? null,
      intent: (intent as any) ?? null,
    },
  });

  logger.info('[AUTO_CREATE_RULE] Created rule', {
    ruleId: rule.id,
    pattern,
    role,
    glAccountId,
  });

  return { created: true, ruleId: rule.id };
}

// ─── correctionLearning ──────────────────────────────────────────────
//
// Records a correction learning signal when an operator confirms a role
// that differs from the AI suggestion. Metadata only — no BankRule is
// created automatically from this path.

export interface CorrectionLearningInput {
  companyId: string;
  entityKey: string;
  fromSuggested: string | null;
  toConfirmed: string;
  userId?: string;
}

export async function recordCorrectionLearning(
  input: CorrectionLearningInput,
): Promise<void> {
  const { companyId, entityKey, fromSuggested, toConfirmed, userId } = input;

  // Only record when there is an actual correction (suggestion ≠ confirmation)
  if (!fromSuggested || fromSuggested === toConfirmed) {
    return;
  }

  logger.info('[CORRECTION_LEARNING]', {
    companyId,
    entityKey,
    fromSuggested,
    toConfirmed,
    userId,
  });

  // Persist correction as an AuditLog entry for future learning reference
  if (userId) {
    await db.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'ENTITY_CORRECTION_LEARNING',
        entity: 'EntityContext',
        entityId: entityKey,
        details: JSON.stringify({
          correctionLearning: {
            fromSuggested,
            toConfirmed,
            entityKey,
          },
        }),
      },
    });
  }
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
    where: { companyId, role: { not: null }, classificationStatus: 'CONFIRMED' },
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
