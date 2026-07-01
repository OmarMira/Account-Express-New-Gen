import { describe, expect, it } from 'vitest';

import {
  analyzeEntityHistory,
  isEligibleForReevaluation,
  type EntityHistoryTransaction,
} from '@/lib/services/entity-history-analyzer';
import {
  buildSmartClassificationPrompt,
  classifyEntityFromHistory,
  scoreSmartClassificationConfidence,
} from '@/lib/services/smart-entity-classifier';

const monthlyRentHistory: EntityHistoryTransaction[] = [
  { id: 'tx-1', description: 'Zelle from River Tenant January rent', amount: 1200, date: '2026-01-05' },
  { id: 'tx-2', description: 'Zelle from River Tenant February rent', amount: 1200, date: '2026-02-05' },
  { id: 'tx-3', description: 'Zelle from River Tenant March rent', amount: 1200, date: '2026-03-05' },
  { id: 'tx-4', description: 'Zelle from River Tenant April rent', amount: 1200, date: '2026-04-05' },
];

describe('PR2 entity history aggregation', () => {
  it('summarizes recurring entity history before classification', () => {
    const summary = analyzeEntityHistory({
      entityKey: 'river tenant',
      canonicalName: 'River Tenant',
      transactions: monthlyRentHistory,
    });

    expect(summary.transactionCount).toBe(4);
    expect(summary.totalAmountAbs).toBe(4800);
    expect(summary.activeMonths).toBe(4);
    expect(summary.directionProfile).toEqual({ creditPct: 1, debitPct: 0, dominant: 'credit' });
    expect(summary.amountStats).toEqual({ min: 1200, max: 1200, average: 1200, median: 1200 });
    expect(summary.averageIntervalDays).toBe(30);
    expect(summary.recurrenceLabel).toBe('monthly');
    expect(summary.representativeDescriptions).toContain('Zelle from River Tenant January rent');
    expect(summary.recentDescriptions).toEqual([
      'Zelle from River Tenant April rent',
      'Zelle from River Tenant March rent',
      'Zelle from River Tenant February rent',
    ]);
  });

  it('keeps single-transaction cold starts low evidence but still summarized', () => {
    const summary = analyzeEntityHistory({
      entityKey: 'first vendor',
      canonicalName: 'First Vendor',
      transactions: [
        { id: 'tx-1', description: 'Debit card purchase First Vendor', amount: -95.5, date: '2026-05-10' },
      ],
    });

    expect(summary.transactionCount).toBe(1);
    expect(summary.activeMonths).toBe(1);
    expect(summary.directionProfile).toEqual({ creditPct: 0, debitPct: 1, dominant: 'debit' });
    expect(summary.averageIntervalDays).toBeNull();
    expect(summary.recurrenceLabel).toBe('one-time');
  });

  it('detects mixed direction and biweekly recurrence', () => {
    const summary = analyzeEntityHistory({
      entityKey: 'partner draws',
      canonicalName: 'Partner Draws',
      transactions: [
        { id: 'tx-1', description: 'ACH credit Partner Draws', amount: 1000, date: '2026-01-01' },
        { id: 'tx-2', description: 'ACH debit Partner Draws', amount: -1000, date: '2026-01-15' },
        { id: 'tx-3', description: 'ACH credit Partner Draws', amount: 1000, date: '2026-01-29' },
        { id: 'tx-4', description: 'ACH debit Partner Draws', amount: -1000, date: '2026-02-12' },
      ],
    });

    expect(summary.directionProfile.dominant).toBe('mixed');
    expect(summary.directionProfile.creditPct).toBe(0.5);
    expect(summary.directionProfile.debitPct).toBe(0.5);
    expect(summary.averageIntervalDays).toBe(14);
    expect(summary.recurrenceLabel).toBe('biweekly');
  });

  it('preserves prior context, linked rules, and user descriptions for review context', () => {
    const summary = analyzeEntityHistory({
      entityKey: 'legacy other',
      canonicalName: 'Legacy Other',
      transactions: monthlyRentHistory,
      priorContext: {
        role: null,
        status: 'PENDING_REVIEW',
        confidence: null,
        userDescription: 'Owner said this might be a tenant payment.',
      },
      priorRules: [{ id: 'rule-1', conditionValue: 'legacy other', intent: 'rent' }],
    });

    expect(summary.priorContext?.userDescription).toBe('Owner said this might be a tenant payment.');
    expect(summary.priorRules).toEqual([{ id: 'rule-1', conditionValue: 'legacy other', intent: 'rent' }]);
  });
});

describe('PR2 prompt enrichment and confidence scoring', () => {
  it('builds prompts from runtime tenant and summary data without hardcoded examples', () => {
    const summary = analyzeEntityHistory({
      entityKey: 'runtime supplier',
      canonicalName: 'Runtime Supplier LLC',
      transactions: [
        { id: 'tx-1', description: 'ACH payment to Runtime Supplier LLC', amount: -320, date: '2026-01-01' },
        { id: 'tx-2', description: 'ACH payment to Runtime Supplier LLC', amount: -330, date: '2026-02-01' },
        { id: 'tx-3', description: 'ACH payment to Runtime Supplier LLC', amount: -325, date: '2026-03-01' },
      ],
    });

    const prompt = buildSmartClassificationPrompt({
      tenant: { companyName: 'Acme Holdings', locale: 'en-US' },
      history: summary,
    });

    expect(prompt.user).toContain('Acme Holdings');
    expect(prompt.user).toContain('Runtime Supplier LLC');
    expect(prompt.user).toContain('3 transactions');
    expect(prompt.user).toContain('100% debit');
    expect(prompt.user).not.toContain('Laura Quijano');
    expect(prompt.user).not.toContain('62,302');
    expect(prompt.user).not.toContain('Toyota, Kia');
  });

  it('combines history, direction, recurrence, prior context, LLM confidence, and heuristic agreement', () => {
    const summary = analyzeEntityHistory({
      entityKey: 'river tenant',
      canonicalName: 'River Tenant',
      transactions: monthlyRentHistory,
      priorConfirmations: [{ role: 'INQUILINO', intent: 'rent', confirmedAt: '2026-01-10' }],
    });

    const score = scoreSmartClassificationConfidence({
      history: summary,
      heuristicRole: 'INQUILINO',
      llm: { role: 'INQUILINO', confidence: 0.86 },
    });

    expect(score.confidence).toBeGreaterThanOrEqual(0.8);
    expect(score.confidenceLabel).toBe('high');
    expect(score.factors).toContain('sufficient-history');
    expect(score.factors).toContain('pure-direction');
    expect(score.factors).toContain('recurring-history');
    expect(score.factors).toContain('prior-confirmation');
    expect(score.factors).toContain('llm-agrees-with-heuristic');
  });

  it('caps mixed direction and pending/null-role context below high confidence', () => {
    const summary = analyzeEntityHistory({
      entityKey: 'mixed entity',
      canonicalName: 'Mixed Entity',
      transactions: [
        { id: 'tx-1', description: 'Credit Mixed Entity', amount: 500, date: '2026-01-01' },
        { id: 'tx-2', description: 'Debit Mixed Entity', amount: -500, date: '2026-02-01' },
        { id: 'tx-3', description: 'Credit Mixed Entity', amount: 500, date: '2026-03-01' },
        { id: 'tx-4', description: 'Debit Mixed Entity', amount: -500, date: '2026-04-01' },
      ],
      priorContext: { role: null, status: 'PENDING_REVIEW', confidence: null },
    });

    const score = scoreSmartClassificationConfidence({
      history: summary,
      heuristicRole: 'SOCIO',
      llm: { role: 'SOCIO', confidence: 0.91 },
    });

    expect(score.confidence).toBeLessThan(0.8);
    expect(score.confidenceLabel).not.toBe('high');
    expect(score.requiresReview).toBe(true);
    expect(score.factors).toContain('mixed-direction-cap');
    expect(score.factors).toContain('pending-context-no-boost');
  });
});

describe('PR2 cold-start and re-evaluation lifecycle', () => {
  it('returns provisional low-confidence suggestions with one review question for cold starts', () => {
    const history = analyzeEntityHistory({
      entityKey: 'new vendor',
      canonicalName: 'New Vendor',
      transactions: [
        { id: 'tx-1', description: 'Debit purchase New Vendor', amount: -41, date: '2026-06-01' },
      ],
    });

    const suggestion = classifyEntityFromHistory({ history });

    expect(suggestion.suggestedRole).toBe('PROVEEDOR');
    expect(suggestion.confidenceLabel).toBe('low');
    expect(suggestion.requiresConfirmation).toBe(true);
    expect(suggestion.reviewQuestion).toBe('What is this entity for your business?');
    expect(suggestion.lifecycle).toEqual({ provisional: true, eligibleForReevaluation: true });
  });

  it('suggests updates without overwriting confirmed classifications', () => {
    const history = analyzeEntityHistory({
      entityKey: 'confirmed customer',
      canonicalName: 'Confirmed Customer',
      transactions: [
        { id: 'tx-1', description: 'Debit Confirmed Customer refund', amount: -200, date: '2026-01-01' },
        { id: 'tx-2', description: 'Debit Confirmed Customer refund', amount: -220, date: '2026-02-01' },
        { id: 'tx-3', description: 'Debit Confirmed Customer refund', amount: -210, date: '2026-03-01' },
      ],
      priorContext: { role: 'CLIENTE', status: 'CONFIRMED', confidence: 0.93 },
    });

    const suggestion = classifyEntityFromHistory({ history });

    expect(suggestion.suggestedRole).toBe('PROVEEDOR');
    expect(suggestion.confirmedClassificationProtected).toBe(true);
    expect(suggestion.updateSuggestion).toEqual({ fromRole: 'CLIENTE', toRole: 'PROVEEDOR' });
    expect(isEligibleForReevaluation(history)).toBe(true);
  });
});
