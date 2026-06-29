import { TRANSACTION_INTENT_VALUES, transactionIntentSchema } from '@/lib/constants/transaction-intent';
import { TransactionIntent } from '@prisma/client';

describe('TransactionIntent consistency', () => {
  it('Zod enum matches Prisma enum values', () => {
    const prismaValues = Object.values(TransactionIntent);
    expect(prismaValues.sort()).toEqual([...TRANSACTION_INTENT_VALUES].sort());
  });

  it('each value is accepted by the Zod schema', () => {
    for (const value of TRANSACTION_INTENT_VALUES) {
      expect(() => transactionIntentSchema.parse(value)).not.toThrow();
    }
  });

  it('invalid value is rejected by the Zod schema', () => {
    expect(() => transactionIntentSchema.parse('INVALID')).toThrow();
  });
});
