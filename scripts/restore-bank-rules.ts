#!/usr/bin/env tsx
/**
 * restore-bank-rules.ts — Restore BankRule records from JSON backup.
 *
 * Part of PR #4b (Unify Detection Pipelines) — rollback companion for
 * normalization-migration.ts.
 *
 * Reads a JSON backup file (created by normalization-migration.ts --dump)
 * and restores each BankRule record via Prisma upsert.
 *
 * Full rollback procedure:
 *   1. npx tsx scripts/restore-bank-rules.ts [./bank-rule-backup.json]
 *      — Restore BankRule data from JSON
 *   2. git revert HEAD
 *      — Revert code changes
 *   3. npx vitest
 *      — Verify no regressions
 *
 * Usage:
 *   npx tsx scripts/restore-bank-rules.ts                          # default: ./bank-rule-backup.json
 *   npx tsx scripts/restore-bank-rules.ts ./custom-backup.json
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

async function main(): Promise<void> {
  const backupPath = process.argv[2] || './bank-rule-backup.json';
  const db = new PrismaClient();

  console.log(`[restore] Reading backup from ${backupPath}`);

  let backup: any[];
  try {
    const raw = readFileSync(backupPath, 'utf-8');
    backup = JSON.parse(raw);
  } catch (err) {
    console.error(`[restore] Failed to read backup file "${backupPath}":`, err);
    process.exit(1);
  }

  if (!Array.isArray(backup) || backup.length === 0) {
    console.error(`[restore] Backup file is empty or invalid: ${backupPath}`);
    process.exit(1);
  }

  console.log(`[restore] Restoring ${backup.length} BankRule records...`);

  let restored = 0;
  let errors = 0;

  for (const rule of backup) {
    const { id, ...data } = rule;
    try {
      await db.bankRule.upsert({
        where: { id },
        update: data,
        create: { id, ...data },
      });
      restored++;
    } catch (err) {
      console.error(`[restore] Failed to restore rule ${id}:`, err);
      errors++;
    }
  }

  console.log(`[restore] Restored ${restored}/${backup.length} BankRule records from ${backupPath}`);
  if (errors > 0) {
    console.warn(`[restore] ${errors} records failed — check logs above`);
  }

  process.exit(errors > 0 && restored === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[restore] Fatal error:', err);
  process.exit(1);
});
