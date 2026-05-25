export function validateStatementBalance(statement: {
  openingBalance?: number;
  closingBalance?: number;
  transactions: { amount: number }[];
}) {
  const credits = statement.transactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const debits = statement.transactions
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const beginning = statement.openingBalance ?? 0;
  const expected = statement.closingBalance ?? 0;
  const calculated = beginning + credits - debits;
  const diff = Math.abs(calculated - expected);

  return {
    isValid: diff < 0.01, // Float tolerance
    calculated: Number(calculated.toFixed(2)),
    expected: Number(expected.toFixed(2)),
    diff: Number(diff.toFixed(2)),
  };
}
