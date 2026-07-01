import { db } from '@/lib/db';
import { normalizePattern } from '@/lib/services/pattern-normalizer';

export type DirectionDominant = 'credit' | 'debit' | 'mixed';
export type RecurrenceLabel = 'weekly' | 'biweekly' | 'monthly' | 'sporadic' | 'one-time';

export interface EntityHistoryTransaction {
  id?: string;
  description: string;
  amount: number | { toString(): string };
  date: string | Date;
}

export interface EntityPriorConfirmation {
  role: string | null;
  intent?: string | null;
  confirmedAt?: string;
}

export interface EntityPriorRule {
  id: string;
  conditionValue: string;
  intent?: string | null;
}

export interface EntityPriorContext {
  role: string | null;
  status?: string;
  confidence?: number | null;
  userDescription?: string | null;
}

export interface EntityHistorySummary {
  entityKey: string;
  canonicalName: string;
  transactionCount: number;
  totalAmountAbs: number;
  activeMonths: number;
  directionProfile: { creditPct: number; debitPct: number; dominant: DirectionDominant };
  averageIntervalDays: number | null;
  recurrenceLabel: RecurrenceLabel;
  amountStats: { min: number; max: number; average: number; median: number };
  representativeDescriptions: string[];
  recentDescriptions: string[];
  priorConfirmations: EntityPriorConfirmation[];
  priorRules: EntityPriorRule[];
  priorContext: EntityPriorContext | null;
}

export interface AnalyzeEntityHistoryInput {
  entityKey: string;
  canonicalName: string;
  transactions: EntityHistoryTransaction[];
  priorConfirmations?: EntityPriorConfirmation[];
  priorRules?: EntityPriorRule[];
  priorContext?: EntityPriorContext | null;
}

export interface AnalyzeEntityHistoryForCompanyInput {
  companyId: string;
  entityKey: string;
  canonicalName: string;
  take?: number;
}

const MAX_DESCRIPTIONS = 3;
const MIXED_DIRECTION_THRESHOLD = 0.2;

export function analyzeEntityHistory(input: AnalyzeEntityHistoryInput): EntityHistorySummary {
  const sorted = [...input.transactions].sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
  const amounts = sorted.map((tx) => Math.abs(toNumber(tx.amount)));
  const transactionCount = sorted.length;
  const totalAmountAbs = roundMoney(amounts.reduce((total, amount) => total + amount, 0));
  const creditCount = sorted.filter((tx) => toNumber(tx.amount) > 0).length;
  const debitCount = sorted.filter((tx) => toNumber(tx.amount) < 0).length;
  const creditPct = transactionCount > 0 ? roundRatio(creditCount / transactionCount) : 0;
  const debitPct = transactionCount > 0 ? roundRatio(debitCount / transactionCount) : 0;
  const intervals = calculateIntervals(sorted.map((tx) => toDate(tx.date)));
  const averageIntervalDays = intervals.length > 0 ? Math.round(average(intervals)) : null;

  return {
    entityKey: input.entityKey,
    canonicalName: input.canonicalName,
    transactionCount,
    totalAmountAbs,
    activeMonths: countActiveMonths(sorted.map((tx) => toDate(tx.date))),
    directionProfile: {
      creditPct,
      debitPct,
      dominant: resolveDominantDirection(creditPct, debitPct),
    },
    averageIntervalDays,
    recurrenceLabel: resolveRecurrenceLabel(transactionCount, averageIntervalDays),
    amountStats: buildAmountStats(amounts),
    representativeDescriptions: uniqueDescriptions(sorted.map((tx) => tx.description)).slice(0, MAX_DESCRIPTIONS),
    recentDescriptions: uniqueDescriptions([...sorted].reverse().map((tx) => tx.description)).slice(0, MAX_DESCRIPTIONS),
    priorConfirmations: input.priorConfirmations ?? [],
    priorRules: input.priorRules ?? [],
    priorContext: input.priorContext ?? null,
  };
}

export async function analyzeEntityHistoryForCompany(
  input: AnalyzeEntityHistoryForCompanyInput,
): Promise<EntityHistorySummary> {
  const normalizedEntity = normalizePattern(input.entityKey || input.canonicalName).toLowerCase();
  const transactions = await db.bankTransaction.findMany({
    where: {
      statement: { bankAccount: { companyId: input.companyId } },
      description: { contains: input.canonicalName },
    },
    select: { id: true, description: true, amount: true, date: true },
    orderBy: { date: 'asc' },
    take: input.take ?? 2000,
  });

  const priorContext = await db.entityContext.findUnique({
    where: { companyId_pattern: { companyId: input.companyId, pattern: normalizedEntity } },
    select: {
      role: true,
      classificationStatus: true,
      classificationConfidence: true,
      userDescription: true,
    },
  });

  const priorRules = await db.bankRule.findMany({
    where: { companyId: input.companyId, conditionValue: { contains: input.canonicalName } },
    select: { id: true, conditionValue: true, conditions: true },
  });

  return analyzeEntityHistory({
    entityKey: normalizedEntity,
    canonicalName: input.canonicalName,
    transactions,
    priorContext: priorContext
      ? {
          role: priorContext.role,
          status: priorContext.classificationStatus,
          confidence: priorContext.classificationConfidence,
          userDescription: priorContext.userDescription,
        }
      : null,
    priorConfirmations:
      priorContext?.classificationStatus === 'CONFIRMED'
        ? [{ role: priorContext.role, confirmedAt: undefined }]
        : [],
    priorRules: priorRules.map((rule) => ({
      id: rule.id,
      conditionValue: rule.conditionValue,
      intent: extractIntentFromRuleConditions(rule.conditions),
    })),
  });
}

export function isEligibleForReevaluation(summary: EntityHistorySummary): boolean {
  if (summary.transactionCount < 2) return true;
  if (summary.priorContext?.status === 'PENDING_REVIEW' || summary.priorContext?.status === 'UNCLASSIFIED') {
    return true;
  }
  if (summary.priorContext?.status === 'CONFIRMED') return true;
  return summary.activeMonths >= 2 || summary.recurrenceLabel !== 'one-time';
}

function resolveDominantDirection(creditPct: number, debitPct: number): DirectionDominant {
  if (creditPct >= 1 - MIXED_DIRECTION_THRESHOLD && debitPct <= MIXED_DIRECTION_THRESHOLD) return 'credit';
  if (debitPct >= 1 - MIXED_DIRECTION_THRESHOLD && creditPct <= MIXED_DIRECTION_THRESHOLD) return 'debit';
  return 'mixed';
}

function resolveRecurrenceLabel(count: number, averageIntervalDays: number | null): RecurrenceLabel {
  if (count <= 1 || averageIntervalDays === null) return 'one-time';
  if (averageIntervalDays >= 5 && averageIntervalDays <= 9) return 'weekly';
  if (averageIntervalDays >= 10 && averageIntervalDays <= 18) return 'biweekly';
  if (averageIntervalDays >= 25 && averageIntervalDays <= 35) return 'monthly';
  return 'sporadic';
}

function buildAmountStats(amounts: number[]): EntityHistorySummary['amountStats'] {
  if (amounts.length === 0) return { min: 0, max: 0, average: 0, median: 0 };
  const sorted = [...amounts].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? average([sorted[middle - 1], sorted[middle]]) : sorted[middle];
  return {
    min: roundMoney(sorted[0]),
    max: roundMoney(sorted[sorted.length - 1]),
    average: roundMoney(average(sorted)),
    median: roundMoney(median),
  };
}

function calculateIntervals(dates: Date[]): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < dates.length; index += 1) {
    intervals.push(Math.round((dates[index].getTime() - dates[index - 1].getTime()) / 86_400_000));
  }
  return intervals;
}

function countActiveMonths(dates: Date[]): number {
  return new Set(dates.map((date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`)).size;
}

function uniqueDescriptions(descriptions: string[]): string[] {
  return [...new Set(descriptions.map((description) => description.trim()).filter(Boolean))];
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function toNumber(value: number | { toString(): string }): number {
  return typeof value === 'number' ? value : Number(value.toString());
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractIntentFromRuleConditions(conditions: unknown): string | null {
  if (!conditions || typeof conditions !== 'object') return null;
  if ('intent' in conditions && typeof conditions.intent === 'string') return conditions.intent;
  return null;
}
