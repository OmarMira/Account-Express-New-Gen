import { normalizePattern } from '@/lib/services/pattern-normalizer';
import { loadConfig, extractComponents } from '@/lib/services/entity-detector';
import type { EntityCandidate } from '@/lib/services/entity-detector';
import type { EntityContextWithGlAccount } from '@/lib/types/entity-context';
import { ENTITY_ROLES, EXPECTED_DIRECTION, type EntityRole } from '@/lib/constants/entity-roles';
import { ROLE_ACCOUNT_MAP } from '@/lib/constants/role-account-map';
import { toConfidenceLabel } from '@/lib/types/reasoning';
import { serverT } from '@/lib/server-i18n';

// ========== TYPES ==========

export interface EnrichmentInput {
  contexts: EntityContextWithGlAccount[];
  glAccounts: Array<{
    id: string;
    name: string;
    code: string;
    accountType?: string;
  }>;
  rolePriorities?: Record<string, number>;
  knownSocioPatterns?: string[];
  existingRules?: Array<{
    conditionValue: string | null;
    conditionType: string | null;
  }>;
}

export interface EnrichedCandidate extends EntityCandidate {
  hasContext: boolean;
  contextRole: string;
  suggestedAccountName: string;
  suggestedAccountCode: string;
  suggestedAccountId: string;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  explanation: string;
  directionWarning?: string | null;
}

export interface ScanEntry {
  count: number;
  sample: string;
  totalAmount: number;
  debitCount: number;
  creditCount: number;
}

export interface ScanPattern {
  id: string;
  description: string;
  rawDescription: string;
  occurrences: number;
  direction: string;
  averageAmount: number;
  suggestedAccount: string;
  suggestedAccountCode: string;
  suggestedAccountId: string;
  hasContext: boolean;
  contextRole: string;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  explanation: string;
  uncertaintyReasons?: string[];
}

// ========== T5a: RESOLVE CONTEXT ROLE ==========

export function resolveContextRole(
  candidate: EntityCandidate,
  description: string,
  input: EnrichmentInput,
): EntityContextWithGlAccount | null {
  const normalizedDesc = normalizePattern(description);
  const candidateNameLower = candidate.canonicalName.toLowerCase();

  // Filter matching contexts
  let matchingContexts = input.contexts.filter((ctx) => {
    if (!ctx.role || ctx.classificationStatus === 'PENDING_REVIEW' || ctx.classificationStatus === 'UNCLASSIFIED') {
      return false;
    }
    const patternLower = ctx.pattern.toLowerCase();
    return (
      normalizedDesc.includes(patternLower) ||
      candidateNameLower.includes(patternLower) ||
      patternLower.includes(candidateNameLower)
    );
  });

  // SOCIO conflict detection: exclude SOCIO contexts when merchant + SOCIO INDN conflict
  if (input.knownSocioPatterns?.length && hasSocioConflict(description, input.knownSocioPatterns)) {
    matchingContexts = matchingContexts.filter((ctx) => ctx.role?.toUpperCase() !== 'SOCIO');
  }

  if (matchingContexts.length === 0) return null;
  if (matchingContexts.length === 1) return matchingContexts[0];

  // Multiple matches: sort by role priority (lower number = higher priority)
  const priorities = input.rolePriorities ?? {};
  return [...matchingContexts].sort((a, b) => {
    const prioA = priorities[a.role?.toUpperCase() ?? ''] ?? 99;
    const prioB = priorities[b.role?.toUpperCase() ?? ''] ?? 99;
    return prioA - prioB;
  })[0];
}

/**
 * Detect SOCIO conflict: merchant at P1 + SOCIO name at P3/INDN.
 * When both are present, the merchant is the entity, not the SOCIO.
 */
function hasSocioConflict(
  description: string,
  knownSocioPatterns: string[],
): boolean {
  if (!knownSocioPatterns?.length) return false;

  const config = loadConfig();
  const components = extractComponents(description, config);

  if (components.merchant && components.indnName) {
    return knownSocioPatterns.some((p) =>
      components.indnName!.toLowerCase().includes(p.toLowerCase()),
    );
  }

  return false;
}

// ========== T5b: SUGGEST GL ACCOUNT ==========

export function suggestGlAccount(
  context: EntityContextWithGlAccount | null,
  direction: 'debit' | 'credit' | null,
  glAccounts: EnrichmentInput['glAccounts'],
): { name: string; code: string; id: string } | null {
  if (!context) return null;

  // Priority 1: context has linked glAccount
  if (context.glAccount) {
    return {
      name: context.glAccount.name,
      code: context.glAccount.code,
      id: context.glAccount.id,
    };
  }

  if (!context.role) return null;

  // Priority 2: resolve via ROLE_ACCOUNT_MAP
  const role = context.role.toUpperCase();
  let mapping = ROLE_ACCOUNT_MAP[role as EntityRole];

  // Priority 2b: parcial — roles compuestos/personalizados como "EMPRESA DE LOS SOCIOS"
  // que contienen un rol canónico pero no son iguales exactamente.
  if (!mapping) {
    const matchedCanonical = (Object.keys(ROLE_ACCOUNT_MAP) as EntityRole[]).find(
      (cr) => role.includes(cr),
    );
    if (matchedCanonical) {
      mapping = ROLE_ACCOUNT_MAP[matchedCanonical];
    }
  }

  if (mapping) {
    const targetCode = direction ? (direction === 'debit' ? mapping.debit : mapping.credit) : mapping.fallback;
    let account = glAccounts.find((a) => a.code === targetCode);
    if (!account && targetCode !== mapping.fallback) {
      account = glAccounts.find((a) => a.code === mapping.fallback);
    }
    if (account) {
      return {
        name: account.name,
        code: account.code,
        id: account.id,
      };
    }
  }

  return null;
}

// ========== T5c: RESOLVE DIRECTION ==========

export function resolveDirection(
  candidate: EntityCandidate,
): 'debit' | 'credit' | null {
  const { creditPct, debitPct } = candidate.directionProfile;

  if (debitPct > 0.5) return 'debit';
  if (creditPct > 0.5) return 'credit';
  return null;
}

// ========== DIRECTION MISMATCH CHECK ==========

/**
 * Check if a role's expected transaction direction conflicts with the actual
 * direction profile of an entity candidate.
 *
 * - OTRO / IGNORADA (expectedDirection = null) → no warning
 * - SOCIO (expectedDirection = 'mixed') → no warning
 * - CLIENTE / INGRESO / INQUILINO (expected = 'credit') with debitPct > 0.5 → warning
 * - PROVEEDOR / EMPLEADO / GASTO_OPERATIVO / TARJETA_CREDITO / PRESTAMO (expected = 'debit') with creditPct > 0.5 → warning
 *
 * @returns `{ warning: string }` when a mismatch is detected, otherwise `null`.
 */
export function checkRoleDirectionMismatch(
  role: string,
  debitPct: number,
  creditPct: number,
): { warning: string } | null {
  const upperRole = role.toUpperCase();

  // Only check canonical roles
  if (!ENTITY_ROLES.includes(upperRole as EntityRole)) return null;

  const expectedDirection = EXPECTED_DIRECTION[upperRole as EntityRole];

  // OTRO / IGNORADA (null) and SOCIO (mixed) never warn
  if (expectedDirection === null || expectedDirection === 'mixed') return null;

  if (expectedDirection === 'credit' && debitPct > 0.5) {
    return { warning: `Role ${upperRole} expects credits but most transactions are debits` };
  }

  if (expectedDirection === 'debit' && creditPct > 0.5) {
    return { warning: `Role ${upperRole} expects debits but most transactions are credits` };
  }

  return null;
}

// ========== T5d: BUILD SCAN PATTERN ==========

export function buildScanPattern(
  enriched: EnrichedCandidate,
  entityKey: string,
  entry: ScanEntry,
): ScanPattern {
  const isDebit = entry.debitCount >= entry.creditCount;

  return {
    id: Buffer.from(entityKey).toString('base64').replace(/=/g, ''),
    description: entityKey,
    rawDescription: entry.sample,
    occurrences: entry.count,
    direction: isDebit ? 'debit' : 'credit',
    averageAmount: entry.totalAmount / entry.count,
    suggestedAccount: enriched.suggestedAccountName,
    suggestedAccountCode: enriched.suggestedAccountCode,
    suggestedAccountId: enriched.suggestedAccountId,
    hasContext: enriched.hasContext,
    contextRole: enriched.contextRole,
    confidence: enriched.confidence,
    confidenceLabel: enriched.confidenceLabel,
    explanation: enriched.explanation,
  };
}

// ========== T6: ENRICH CANDIDATES PIPELINE ==========

export function enrichCandidates(
  candidates: EntityCandidate[],
  descriptions: Map<string, string>,
  input: EnrichmentInput,
  options?: {
    smartFrequency?: boolean;
    minOccurrences?: number;
  },
  locale?: string,
): EnrichedCandidate[] {
  const result: EnrichedCandidate[] = [];

  for (const candidate of candidates) {
    const entityKey = candidate.canonicalName.toLowerCase();
    const description = descriptions.get(entityKey) ?? candidate.sampleDescriptions[0] ?? '';

    // Step 1: resolve context role
    const context = resolveContextRole(candidate, description, input);

    // Step 2: smartFrequency — adjust minOccurrences threshold
    let effectiveMinOccurrences = options?.minOccurrences ?? 1;
    if (options?.smartFrequency) {
      effectiveMinOccurrences = context ? 1 : (options?.minOccurrences ?? 2);
    }
    if (candidate.occurrences < effectiveMinOccurrences) continue;

    // Step 3: suggest GL account
    const direction = resolveDirection(candidate);
    const suggested = suggestGlAccount(context, direction, input.glAccounts);

    // Step 4: compute confidence
    const confidence = context ? 0.95 : 0.0;
    const confidenceLabel = toConfidenceLabel(confidence);
    const explanation = context
      ? serverT(locale, 'reasoning.entityContextHigh')
          .replace('{role}', context.role ?? '')
          .replace('{confidence}', String(Math.round(confidence * 100)))
      : serverT(locale, 'reasoning.sinClasificar')
          .replace('{reasons}', serverT(locale, 'reasoning.uncertaintyNoContext'));

    // Step 5: skip if an existing rule already covers this pattern
    if (hasExistingRule(candidate, description, input.existingRules)) continue;

    // Step 6: check role ↔ direction mismatch
    const roleToCheck = context?.role ?? '';
    const directionWarning = roleToCheck
      ? checkRoleDirectionMismatch(roleToCheck, candidate.directionProfile.debitPct, candidate.directionProfile.creditPct)
      : null;

    result.push({
      ...candidate,
      hasContext: context !== null,
      contextRole: context?.role ?? '',
      suggestedAccountName: suggested?.name ?? '',
      suggestedAccountCode: suggested?.code ?? '',
      suggestedAccountId: suggested?.id ?? '',
      confidence,
      confidenceLabel,
      explanation,
      directionWarning: directionWarning?.warning ?? null,
    });
  }

  return result;
}

/**
 * Check if an existing rule already covers this candidate's pattern.
 */
function hasExistingRule(
  candidate: EntityCandidate,
  sampleDescription: string,
  existingRules?: EnrichmentInput['existingRules'],
): boolean {
  if (!existingRules?.length) return false;

  const entName = candidate.canonicalName.toLowerCase().trim();
  const rawSample = sampleDescription.toLowerCase().trim();

  return existingRules.some((r) => {
    if (!r.conditionValue) return false;
    const cond = r.conditionValue.toLowerCase().trim();

    const nameMatch = entName.includes(cond) || cond.includes(entName);
    const rawMatch =
      r.conditionType === 'contains'
        ? rawSample.includes(cond) || cond.includes(rawSample)
        : r.conditionType === 'equals'
          ? rawSample === cond
          : r.conditionType === 'starts_with'
            ? rawSample.startsWith(cond) || cond.startsWith(rawSample)
            : false;

    return nameMatch || rawMatch;
  });
}
