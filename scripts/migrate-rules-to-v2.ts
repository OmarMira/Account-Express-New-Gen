import { db } from '../src/lib/db';

async function run() {
  console.log('🔄 Starting BankRule migration to V2...');

  const rules = await db.bankRule.findMany();
  console.log(`Found ${rules.length} rules to process.`);

  if (rules.length === 0) {
    console.log('✅ No bank rules to migrate.');
    return;
  }

  let migratedCount = 0;

  // Run in a transaction
  await db.$transaction(async (tx) => {
    for (const rule of rules) {
      // 1. Map conditions to V2 JSON format if not already set
      let newConditions: any = rule.conditions;
      if (!newConditions) {
        newConditions = [
          {
            field: 'description',
            operator: rule.conditionType,
            value: rule.conditionValue,
          },
        ];
      }

      // 2. Map GlAccounts (3-way logic)
      let debitGlAccountId: string | null = rule.debitGlAccountId;
      let creditGlAccountId: string | null = rule.creditGlAccountId;

      // If they are not already set, map from legacy
      if (!debitGlAccountId && !creditGlAccountId && rule.glAccountId) {
        const direction = rule.transactionDirection || 'any';
        if (direction === 'debit') {
          debitGlAccountId = rule.glAccountId;
        } else if (direction === 'credit') {
          creditGlAccountId = rule.glAccountId;
        } else {
          // any
          debitGlAccountId = rule.glAccountId;
          creditGlAccountId = rule.glAccountId;
        }
      }

      // Update the rule
      await tx.bankRule.update({
        where: { id: rule.id },
        data: {
          conditions: newConditions,
          debitGlAccountId,
          creditGlAccountId,
        },
      });

      migratedCount++;
    }
  });

  console.log(`✅ Migration completed. Successfully migrated ${migratedCount} rules to V2 format.`);
}

run()
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
