const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  const rules = await db.bankRule.findMany({ take: 2 });
  console.log('Rules:', rules.length);
  if (rules.length > 0) {
    console.log('First rule ID:', rules[0].id);
    try {
      await db.bankRule.delete({ where: { id: rules[0].id } });
      console.log('Deleted OK');
    } catch (e) {
      console.log('Delete error:', e.message);
    }
  }
}
main().then(() => process.exit(0));
