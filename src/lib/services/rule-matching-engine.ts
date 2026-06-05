// src/lib/services/rule-matching-engine.ts
// Centralized rule‑matching engine (DRY implementation)
// Supports legacy V1 format and new V2 format with a conditions array.

export type Transaction = { description: string; amount: number };

export type Rule = {
  // V1 fields (optional, kept for backward compatibility)
  conditionType?: string | null; // e.g. "contains", "starts_with", "amount_greater"
  conditionValue?: string | number | null;
  // V2 field – array of condition objects (typed as any to prevent Prisma JsonValue type compilation errors)
  conditions?: any;
  // Direction of transaction
  transactionDirection?: string | null;
};

/**
 * Evaluate a single condition against a transaction.
 */
function evaluateCondition(tx: Transaction, cond: any): boolean {
  if (!cond || typeof cond !== 'object') return false;
  const field = cond.field;
  const operator = cond.operator;
  const value = cond.value;

  if (!field) return false;

  const txValue = tx[field as keyof Transaction];
  if (txValue === undefined || txValue === null) return false;

  const strTxVal = String(txValue).toLowerCase();
  const strCondVal = String(value).toLowerCase();

  switch (operator) {
    case 'equals':
      if (field === 'amount') {
        return Math.abs(Number(txValue)) === Math.abs(Number(value));
      }
      return strTxVal === strCondVal;
    case 'contains':
      return strTxVal.includes(strCondVal);
    case 'starts_with':
      return strTxVal.startsWith(strCondVal);
    case 'ends_with':
      return strTxVal.endsWith(strCondVal);
    case 'greater_than':
    case 'greaterThan':
    case 'amount_greater':
      return Math.abs(Number(txValue)) > Math.abs(Number(value));
    case 'less_than':
    case 'lessThan':
    case 'amount_less':
      return Math.abs(Number(txValue)) < Math.abs(Number(value));
    default:
      return false;
  }
}

/**
 * Main exported helper – returns true if a transaction satisfies a rule.
 */
export function transactionMatchesRule(tx: Transaction, rule: Rule): boolean {
  // Direction validation
  if (rule.transactionDirection === 'debit' && tx.amount >= 0) return false;
  if (rule.transactionDirection === 'credit' && tx.amount < 0) return false;

  // V2 handling – array of conditions
  if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
    return rule.conditions.every((c) => evaluateCondition(tx, c));
  }

  // Legacy V1 handling
  if (rule.conditionType && rule.conditionValue !== undefined && rule.conditionValue !== null) {
    const field =
      rule.conditionType === 'amount_greater' || rule.conditionType === 'amount_less'
        ? 'amount'
        : 'description';
    return evaluateCondition(tx, {
      field,
      operator: rule.conditionType,
      value: rule.conditionValue,
    });
  }

  return false;
}
