/**
 * One-time DB migration: maps any EntityContext.role NOT IN ENTITY_ROLES to "OTRO".
 *
 * This cleans up legacy free-text role values that existed before the
 * entityRoleSchema (Zod enum) validation was introduced.
 *
 * Run: bun run prisma/scripts/migrate-roles-to-otro.ts
 */

import { db } from '../../src/lib/db';
import { ENTITY_ROLES } from '../../src/lib/constants/entity-roles';

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Scanning for EntityContext records with non-canonical roles...\n');

  // 1. Find all records where role is NOT in ENTITY_ROLES
  const invalidRecords = await db.entityContext.findMany({
    where: {
      NOT: {
        role: { in: ENTITY_ROLES as unknown as string[] },
      },
    },
    select: {
      id: true,
      companyId: true,
      pattern: true,
      role: true,
    },
  });

  if (invalidRecords.length === 0) {
    console.log('✅ No records to migrate — all roles are canonical.');
    return;
  }

  console.log(`Found ${invalidRecords.length} record(s) with non-canonical roles:\n`);

  // 2. Log each one and update
  for (const record of invalidRecords) {
    console.log(`  • [${record.id}] company=${record.companyId} pattern="${record.pattern}" oldRole="${record.role}"`);

    await db.entityContext.update({
      where: { id: record.id },
      data: { role: 'OTRO' },
    });
  }

  // 3. Print summary
  console.log(`\n✅ Migration complete. ${invalidRecords.length} record(s) updated to "OTRO".`);
  console.log('\nSummary:');
  console.log('  Total migrated   :', invalidRecords.length);

  // Count distinct old roles for reporting
  const oldRoles = new Map<string, number>();
  for (const r of invalidRecords) {
    const role = r.role ?? '(null)';
    oldRoles.set(role, (oldRoles.get(role) ?? 0) + 1);
  }

  console.log('  Original roles found:');
  for (const [role, count] of [...oldRoles.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${role}: ${count}`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
