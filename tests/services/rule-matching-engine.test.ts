import { describe, it, expect } from 'vitest';
import { transactionMatchesRule } from '@/lib/services/rule-matching-engine';
import type { Transaction, Rule } from '@/lib/services/rule-matching-engine';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return { description: 'Zelle payment to John', amount: -150.0, ...overrides };
}

function v2Rule(conditions: any[], overrides: Partial<Rule> = {}): Rule {
  return { conditions, ...overrides };
}

function v1Rule(overrides: Partial<Rule> = {}): Rule {
  return {
    conditionType: 'contains',
    conditionValue: 'zelle',
    ...overrides,
  };
}

describe('transactionMatchesRule', () => {
  // ── Direction ──────────────────────────────────────────
  describe('direction filter', () => {
    it('returns false if direction=debit and amount >= 0', () => {
      expect(transactionMatchesRule(tx({ amount: 100 }), v1Rule({ transactionDirection: 'debit' }))).toBe(false);
    });

    it('returns false if direction=credit and amount < 0', () => {
      expect(transactionMatchesRule(tx({ amount: -50 }), v1Rule({ transactionDirection: 'credit' }))).toBe(false);
    });

    it('passes direction filter when direction matches', () => {
      expect(transactionMatchesRule(tx({ amount: -50 }), v1Rule({ transactionDirection: 'debit' }))).toBe(true);
      expect(transactionMatchesRule(tx({ amount: 100 }), v1Rule({ transactionDirection: 'credit' }))).toBe(true);
    });
  });

  // ── V2 conditions ──────────────────────────────────────
  describe('v2 conditions array (AND logic)', () => {
    it('matches all conditions with AND logic', () => {
      const r = v2Rule([
        { field: 'description', operator: 'contains', value: 'Zelle' },
        { field: 'amount', operator: 'greater_than', value: '100' },
      ]);
      expect(transactionMatchesRule(tx({ amount: -200 }), r)).toBe(true);
    });

    it('fails if ANY condition fails (AND)', () => {
      const r = v2Rule([
        { field: 'description', operator: 'contains', value: 'Zelle' },
        { field: 'amount', operator: 'greater_than', value: '200' },
      ]);
      expect(transactionMatchesRule(tx({ amount: -150 }), r)).toBe(false);
    });

    it('supports equals operator on description', () => {
      const r = v2Rule([{ field: 'description', operator: 'equals', value: 'zelle payment to john' }]);
      expect(transactionMatchesRule(tx(), r)).toBe(true);
      expect(transactionMatchesRule(tx({ description: 'Other' }), r)).toBe(false);
    });

    it('supports starts_with operator', () => {
      const r = v2Rule([{ field: 'description', operator: 'starts_with', value: 'Zelle' }]);
      expect(transactionMatchesRule(tx(), r)).toBe(true);
      expect(transactionMatchesRule(tx({ description: 'Payment via Zelle' }), r)).toBe(false);
    });

    it('supports ends_with operator', () => {
      const r = v2Rule([{ field: 'description', operator: 'ends_with', value: 'John' }]);
      expect(transactionMatchesRule(tx(), r)).toBe(true);
      expect(transactionMatchesRule(tx({ description: 'John payment' }), r)).toBe(false);
    });

    it('supports amount_greater and amount_less operators', () => {
      const tx150 = tx({ amount: -150 });
      expect(transactionMatchesRule(tx150, v2Rule([{ field: 'amount', operator: 'amount_greater', value: '100' }]))).toBe(true);
      expect(transactionMatchesRule(tx150, v2Rule([{ field: 'amount', operator: 'amount_greater', value: '200' }]))).toBe(false);
      expect(transactionMatchesRule(tx150, v2Rule([{ field: 'amount', operator: 'amount_less', value: '200' }]))).toBe(true);
      expect(transactionMatchesRule(tx150, v2Rule([{ field: 'amount', operator: 'amount_less', value: '100' }]))).toBe(false);
    });

    it('uses absolute value for amount comparisons', () => {
      expect(transactionMatchesRule(tx({ amount: -150 }), v2Rule([{ field: 'amount', operator: 'equals', value: '150' }]))).toBe(true);
      expect(transactionMatchesRule(tx({ amount: 150 }), v2Rule([{ field: 'amount', operator: 'equals', value: '150' }]))).toBe(true);
    });

    it('normalizes whitespace consistently', () => {
      const r = v2Rule([{ field: 'description', operator: 'contains', value: '  zelle   payment  ' }]);
      expect(transactionMatchesRule(tx({ description: 'Zelle   Payment   to   John' }), r)).toBe(true);
    });

    it('returns false for empty conditions array (falls through)', () => {
      expect(transactionMatchesRule(tx(), v2Rule([]))).toBe(false);
    });

    it('returns false for null/undefined conditions', () => {
      expect(transactionMatchesRule(tx(), v2Rule(null as any))).toBe(false);
    });
  });

  // ── V1 legacy ──────────────────────────────────────────
  describe('v1 legacy fields', () => {
    it('matches by description contains', () => {
      expect(transactionMatchesRule(tx(), v1Rule({ conditionType: 'contains', conditionValue: 'zelle' }))).toBe(true);
      expect(transactionMatchesRule(tx(), v1Rule({ conditionType: 'contains', conditionValue: 'paypal' }))).toBe(false);
    });

    it('matches by amount_greater', () => {
      const r = v1Rule({ conditionType: 'amount_greater', conditionValue: 100 });
      expect(transactionMatchesRule(tx({ amount: -200 }), r)).toBe(true);
      expect(transactionMatchesRule(tx({ amount: -50 }), r)).toBe(false);
    });

    it('matches by amount_less', () => {
      const r = v1Rule({ conditionType: 'amount_less', conditionValue: 200 });
      expect(transactionMatchesRule(tx({ amount: -150 }), r)).toBe(true);
      expect(transactionMatchesRule(tx({ amount: -300 }), r)).toBe(false);
    });

    it('matches by starts_with', () => {
      const r = v1Rule({ conditionType: 'starts_with', conditionValue: 'zelle' });
      expect(transactionMatchesRule(tx({ description: 'Zelle payment' }), r)).toBe(true);
    });

    it('matches by ends_with', () => {
      const r = v1Rule({ conditionType: 'ends_with', conditionValue: 'john' });
      expect(transactionMatchesRule(tx({ description: 'Payment to John' }), r)).toBe(true);
    });
  });

  // ── Edge cases ─────────────────────────────────────────
  describe('edge cases', () => {
    it('returns false when conditionValue is null/undefined', () => {
      const r = v1Rule({ conditionType: 'contains', conditionValue: null });
      expect(transactionMatchesRule(tx(), r)).toBe(false);
    });

    it('v2 takes precedence over v1 when both present', () => {
      const r = {
        conditionType: 'contains',
        conditionValue: 'paypal',
        conditions: [{ field: 'description', operator: 'contains', value: 'zelle' }],
      };
      expect(transactionMatchesRule(tx(), r)).toBe(true);
    });
  });
});
