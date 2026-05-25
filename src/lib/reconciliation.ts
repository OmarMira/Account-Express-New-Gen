import type { ParsedTransaction } from './pdf-parser';

export interface LedgerEntry {
  id: string;
  date: Date;
  amount: number; // Positive = income, Negative = expense
  reference?: string;
  isReconciled: boolean;
}

export function reconcileTransactions(bankTx: ParsedTransaction[], ledger: LedgerEntry[]) {
  return bankTx.map((tx) => {
    let match: LedgerEntry | undefined;
    let confidence: 'high' | 'medium' | 'low' = 'low';

    // 1️⃣ High: Exact match by structured reference
    if (tx.reference) {
      match = ledger.find(
        (l) =>
          !l.isReconciled &&
          l.reference === tx.reference &&
          Math.abs(l.amount) === Math.abs(tx.amount),
      );
      if (match) confidence = 'high';
    }

    // 2️⃣ Medium: Date ±2 days + exact amount match
    if (!match) {
      const txDate = new Date(tx.date);
      match = ledger.find((l) => {
        if (l.isReconciled || Math.abs(l.amount) !== Math.abs(tx.amount)) return false;
        const dayDiff = Math.abs((l.date.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24));
        return dayDiff <= 2;
      });
      if (match) confidence = 'medium';
    }

    return { bank: tx, matchedLedger: match, confidence };
  });
}
