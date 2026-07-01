import { ENTITY_ROLES, type EntityRole } from '@/lib/constants/entity-roles';
import type { EntityHistorySummary } from '@/lib/services/entity-history-analyzer';

export type ConfidenceLabel = 'low' | 'medium' | 'high';

export interface SmartClassificationTenantContext {
  companyName: string;
  locale?: string;
}

export interface SmartClassificationPromptInput {
  tenant: SmartClassificationTenantContext;
  history: EntityHistorySummary;
}

export interface LlmClassificationSignal {
  role: string | null;
  intent?: string | null;
  confidence: number;
}

export interface ConfidenceScoreInput {
  history: EntityHistorySummary;
  heuristicRole: string | null;
  llm?: LlmClassificationSignal | null;
}

export interface ConfidenceScoreResult {
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  requiresReview: boolean;
  factors: string[];
}

export interface SmartClassificationSuggestion {
  suggestedRole: string | null;
  suggestedIntent: string | null;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  explanation: string;
  reviewQuestion?: string;
  requiresConfirmation: true;
  history: EntityHistorySummary;
  lifecycle: { provisional: boolean; eligibleForReevaluation: boolean };
  confirmedClassificationProtected: boolean;
  updateSuggestion?: { fromRole: string; toRole: string };
}

const MIN_HIGH_CONFIDENCE_TRANSACTIONS = 3;
const MIN_HIGH_CONFIDENCE_ACTIVE_MONTHS = 2;
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.55;
const MIXED_DIRECTION_CAP = 0.74;
const COLD_START_CAP = 0.49;

export function buildSmartClassificationPrompt(input: SmartClassificationPromptInput): {
  system: string;
  user: string;
} {
  const { tenant, history } = input;
  const lines = [
    `Company: ${tenant.companyName}`,
    tenant.locale ? `Locale: ${tenant.locale}` : null,
    `Entity: ${history.canonicalName}`,
    `History: ${history.transactionCount} transactions across ${history.activeMonths} active months`,
    `Total absolute amount: ${formatAmount(history.totalAmountAbs)}`,
    `Direction: ${Math.round(history.directionProfile.creditPct * 100)}% credit, ${Math.round(
      history.directionProfile.debitPct * 100,
    )}% debit, dominant ${history.directionProfile.dominant}`,
    `Recurrence: ${history.recurrenceLabel}${
      history.averageIntervalDays === null ? '' : `, about every ${history.averageIntervalDays} days`
    }`,
    `Amount range: ${formatAmount(history.amountStats.min)} to ${formatAmount(
      history.amountStats.max,
    )}; average ${formatAmount(history.amountStats.average)}`,
    history.representativeDescriptions.length > 0
      ? `Representative descriptions: ${history.representativeDescriptions.join(' | ')}`
      : null,
    history.recentDescriptions.length > 0
      ? `Recent descriptions: ${history.recentDescriptions.join(' | ')}`
      : null,
    history.priorContext?.userDescription
      ? `User-provided context: ${history.priorContext.userDescription}`
      : null,
    history.priorContext
      ? `Prior context: role ${history.priorContext.role ?? 'unset'}, status ${
          history.priorContext.status ?? 'unknown'
        }`
      : null,
    history.priorConfirmations.length > 0
      ? `Prior confirmations: ${history.priorConfirmations
          .map((confirmation) => `${confirmation.role ?? 'unset'}${confirmation.intent ? `/${confirmation.intent}` : ''}`)
          .join(', ')}`
      : null,
    history.priorRules.length > 0
      ? `Existing linked rules for review: ${history.priorRules
          .map((rule) => `${rule.id}:${rule.conditionValue}`)
          .join(', ')}`
      : null,
    `Allowed roles: ${ENTITY_ROLES.filter((role) => role !== 'OTRO' && role !== 'IGNORADA').join(', ')}`,
    'Classify the entity role and likely transaction intent from the history. Return strict JSON only: { "role": "ROLE", "intent": "short-intent-or-null", "confidence": 0.0, "explanation": "plain language reason" }.',
  ].filter((line): line is string => Boolean(line));

  return {
    system:
      'You classify accounting entities from aggregated transaction history. Suggestions are provisional until a human confirms them. Return only strict JSON.',
    user: lines.join('\n'),
  };
}

export function scoreSmartClassificationConfidence(input: ConfidenceScoreInput): ConfidenceScoreResult {
  const factors: string[] = [];
  let score = 0.2;
  const { history, heuristicRole, llm } = input;
  const sufficientHistory =
    history.transactionCount >= MIN_HIGH_CONFIDENCE_TRANSACTIONS &&
    history.activeMonths >= MIN_HIGH_CONFIDENCE_ACTIVE_MONTHS;

  if (sufficientHistory) {
    score += 0.18;
    factors.push('sufficient-history');
  } else {
    score -= 0.05;
    factors.push('insufficient-history-cap');
  }

  if (history.directionProfile.dominant === 'mixed') {
    score += 0.03;
    factors.push('mixed-direction-cap');
  } else {
    score += 0.16;
    factors.push('pure-direction');
  }

  if (history.recurrenceLabel !== 'one-time' && history.recurrenceLabel !== 'sporadic') {
    score += 0.16;
    factors.push('recurring-history');
  }

  const confirmedRole = history.priorConfirmations.find((confirmation) => confirmation.role)?.role ?? null;
  if (confirmedRole && (!heuristicRole || confirmedRole === heuristicRole)) {
    score += 0.12;
    factors.push('prior-confirmation');
  } else if (history.priorContext?.status === 'PENDING_REVIEW' || history.priorContext?.status === 'UNCLASSIFIED') {
    factors.push('pending-context-no-boost');
  }

  if (llm) {
    score += clamp(llm.confidence, 0, 1) * 0.2;
    factors.push('llm-confidence');
    if (heuristicRole && llm.role === heuristicRole) {
      score += 0.12;
      factors.push('llm-agrees-with-heuristic');
    } else if (heuristicRole && llm.role && llm.role !== heuristicRole) {
      score -= 0.12;
      factors.push('llm-disagrees-with-heuristic');
    }
  } else if (heuristicRole) {
    score += 0.08;
    factors.push('heuristic-only');
  }

  if (!sufficientHistory) score = Math.min(score, COLD_START_CAP);
  if (history.directionProfile.dominant === 'mixed') score = Math.min(score, MIXED_DIRECTION_CAP);

  score = clamp(round(score), 0, 0.95);
  const confidenceLabel = toConfidenceLabel(score);
  return {
    confidence: score,
    confidenceLabel,
    requiresReview: confidenceLabel !== 'high' || history.directionProfile.dominant === 'mixed',
    factors,
  };
}

export function classifyEntityFromHistory(input: {
  history: EntityHistorySummary;
  llm?: LlmClassificationSignal | null;
}): SmartClassificationSuggestion {
  const heuristicRole = inferRoleFromHistory(input.history);
  const heuristicIntent = inferIntentFromHistory(input.history, heuristicRole);
  const score = scoreSmartClassificationConfidence({
    history: input.history,
    heuristicRole,
    llm: input.llm,
  });
  const priorConfirmedRole =
    input.history.priorContext?.status === 'CONFIRMED' && input.history.priorContext.role
      ? input.history.priorContext.role
      : null;
  const hasConflictingSuggestion = Boolean(
    priorConfirmedRole && heuristicRole && priorConfirmedRole !== heuristicRole,
  );
  const provisional = score.confidenceLabel !== 'high' || input.history.transactionCount < MIN_HIGH_CONFIDENCE_TRANSACTIONS;

  return {
    suggestedRole: heuristicRole,
    suggestedIntent: heuristicIntent,
    confidence: score.confidence,
    confidenceLabel: score.confidenceLabel,
    explanation: buildExplanation(input.history, heuristicRole, score.factors),
    reviewQuestion: score.requiresReview ? 'What is this entity for your business?' : undefined,
    requiresConfirmation: true,
    history: input.history,
    lifecycle: {
      provisional,
      eligibleForReevaluation: provisional || hasConflictingSuggestion || input.history.transactionCount < MIN_HIGH_CONFIDENCE_TRANSACTIONS,
    },
    confirmedClassificationProtected: Boolean(priorConfirmedRole),
    updateSuggestion:
      hasConflictingSuggestion && priorConfirmedRole && heuristicRole
        ? { fromRole: priorConfirmedRole, toRole: heuristicRole }
        : undefined,
  };
}

function inferRoleFromHistory(history: EntityHistorySummary): EntityRole | null {
  if (history.directionProfile.dominant === 'credit') {
    if (history.recurrenceLabel === 'monthly') return 'INQUILINO';
    return 'CLIENTE';
  }
  if (history.directionProfile.dominant === 'debit') {
    if (mentionsAny(history, ['payroll', 'salary', 'wage'])) return 'EMPLEADO';
    if (mentionsAny(history, ['loan', 'mortgage'])) return 'PRESTAMO';
    if (mentionsAny(history, ['card', 'visa', 'mastercard', 'amex', 'american express'])) {
      return 'TARJETA_CREDITO';
    }
    return 'PROVEEDOR';
  }
  return 'SOCIO';
}

function inferIntentFromHistory(history: EntityHistorySummary, role: string | null): string | null {
  if (!role) return null;
  if (role === 'INQUILINO') return 'rent';
  if (role === 'TARJETA_CREDITO') return 'credit-card-payment';
  if (role === 'PRESTAMO') return 'loan-payment';
  if (role === 'EMPLEADO') return 'payroll';
  if (role === 'PROVEEDOR') return history.recurrenceLabel === 'one-time' ? 'vendor-payment' : 'recurring-vendor-payment';
  if (role === 'CLIENTE') return 'customer-payment';
  return null;
}

function buildExplanation(history: EntityHistorySummary, role: string | null, factors: string[]): string {
  const direction = history.directionProfile.dominant === 'credit' ? 'money coming in' : history.directionProfile.dominant === 'debit' ? 'money going out' : 'money moving both ways';
  const recurrence = history.recurrenceLabel === 'one-time' ? 'only one transaction so far' : `${history.recurrenceLabel} activity`;
  const roleText = role ? `Suggested ${role}` : 'No role suggested';
  return `${roleText} because this entity has ${direction}, ${recurrence}, and ${history.transactionCount} transaction(s). Signals: ${factors.join(', ')}.`;
}

function mentionsAny(history: EntityHistorySummary, terms: string[]): boolean {
  const haystack = [...history.representativeDescriptions, ...history.recentDescriptions]
    .join(' ')
    .toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function toConfidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
  return 'low';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatAmount(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
