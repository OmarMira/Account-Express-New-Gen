#!/usr/bin/env tsx
/**
 * normalization-migration.ts — One-shot normalization of all BankRule patterns.
 *
 * Part of PR #4b (Unify Detection Pipelines).
 *
 * Algorithm:
 *   1. Backup ALL BankRule records to JSON (unless --dry-run)
 *   2. Fetch all rules grouped by companyId
 *   3. For each rule: apply normalizePattern(conditionValue)
 *      - No change → skip
 *      - Changed → track for update, group by normalized pattern
 *   4. Detect collisions (same normalized pattern within company):
 *      - Same glAccountId → consolidate (keep manual/most recent, deactivate rest)
 *      - Different glAccountId → CRITICAL (keep both active, log)
 *   5. Apply updates (skip if --dry-run)
 *   6. Write migration-report.json
 *
 * Rollback: npx tsx scripts/restore-bank-rules.ts
 *
 * Usage:
 *   npx tsx scripts/normalization-migration.ts           # live run
 *   npx tsx scripts/normalization-migration.ts --dry-run  # preview only
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { normalizePattern } from '../src/lib/services/pattern-normalizer';

// ── Types ───────────────────────────────────────────────────────────────────

interface MigrationReport {
  runAt: string;
  dryRun: boolean;
  summary: {
    totalRules: number;
    updated: number;
    skipped: number;
    collisions: number;
    critical: number;
  };
  updated: Array<{
    ruleId: string;
    oldPattern: string;
    newPattern: string;
    companyId: string;
  }>;
  skipped: Array<{
    ruleId: string;
    pattern: string;
    companyId: string;
    reason: 'already_normalized';
  }>;
  collisions: Array<{
    normalizedPattern: string;
    companyId: string;
    sameGl: Array<{
      survivorId: string;
      deactivatedId: string;
      glAccountId: string;
      reason: 'manual' | 'updatedAt';
      auditLogged: boolean;
    }>;
    differentGl: Array<{
      ruleIds: string[];
      glAccountIds: string[];
      criticalLogged: boolean;
    }>;
  }>;
  errors: Array<{
    ruleId: string;
    pattern: string;
    error: string;
  }>;
}

interface RuleRecord {
  id: string;
  companyId: string;
  glAccountId: string | null;
  conditionValue: string;
  isManuallyEdited: boolean;
  updatedAt: Date;
  entityContextId: string | null;
  isActive: boolean;
}

interface NormalizedRule {
  rule: RuleRecord;
  normalizedPattern: string;
}

interface RunOptions {
  dryRun: boolean;
  output: string;
  dump: string;
  batchSize: number;
}

// ── CLI Parsing ─────────────────────────────────────────────────────────────

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const options: RunOptions = {
    dryRun: false,
    output: './migration-report.json',
    dump: './bank-rule-backup.json',
    batchSize: 500,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--output':
        options.output = args[++i] || options.output;
        break;
      case '--dump':
        options.dump = args[++i] || options.dump;
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i], 10) || 500;
        break;
      default:
        console.warn(`[migration] Unknown option: ${args[i]}`);
    }
  }

  return options;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function initReport(dryRun: boolean): MigrationReport {
  return {
    runAt: new Date().toISOString(),
    dryRun,
    summary: {
      totalRules: 0,
      updated: 0,
      skipped: 0,
      collisions: 0,
      critical: 0,
    },
    updated: [],
    skipped: [],
    collisions: [],
    errors: [],
  };
}

async function backupBankRules(db: PrismaClient, dumpPath: string): Promise<number> {
  const allRules = await db.bankRule.findMany();
  writeFileSync(dumpPath, JSON.stringify(allRules, null, 2), 'utf-8');
  return allRules.length;
}

async function fetchRulesGroupedByCompany(db: PrismaClient): Promise<Map<string, RuleRecord[]>> {
  const allRules = await db.bankRule.findMany({
    select: {
      id: true,
      companyId: true,
      glAccountId: true,
      conditionValue: true,
      isManuallyEdited: true,
      updatedAt: true,
      entityContextId: true,
      isActive: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const grouped = new Map<string, RuleRecord[]>();
  for (const rule of allRules) {
    const entry: RuleRecord = {
      id: rule.id,
      companyId: rule.companyId,
      glAccountId: rule.glAccountId,
      conditionValue: rule.conditionValue,
      isManuallyEdited: rule.isManuallyEdited,
      updatedAt: rule.updatedAt,
      entityContextId: rule.entityContextId,
      isActive: rule.isActive,
    };
    const existing = grouped.get(rule.companyId);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(rule.companyId, [entry]);
    }
  }
  return grouped;
}

// ── Collision Resolution ────────────────────────────────────────────────────

interface SameGlCollision {
  survivor: NormalizedRule;
  toDeactivate: NormalizedRule[];
  glAccountId: string;
}

interface DifferentGlCollision {
  rules: NormalizedRule[];
  glAccountIds: string[];
}

function groupByGlAccount(rules: NormalizedRule[]): Map<string, NormalizedRule[]> {
  const groups = new Map<string, NormalizedRule[]>();
  for (const r of rules) {
    const key = r.rule.glAccountId ?? '__null__';
    const existing = groups.get(key);
    if (existing) {
      existing.push(r);
    } else {
      groups.set(key, [r]);
    }
  }
  return groups;
}

/**
 * Sort rules for survivor selection:
 * 1. isManuallyEdited=true first
 * 2. then by updatedAt descending (most recent first)
 */
function sortForSurvivor(rules: NormalizedRule[]): void {
  rules.sort((a, b) => {
    if (a.rule.isManuallyEdited !== b.rule.isManuallyEdited) {
      return a.rule.isManuallyEdited ? -1 : 1;
    }
    return b.rule.updatedAt.getTime() - a.rule.updatedAt.getTime();
  });
}

/**
 * Detect collision groups within a company for a single normalized pattern.
 */
function detectCollisions(
  normRules: NormalizedRule[],
): { sameGl: SameGlCollision[]; differentGl: DifferentGlCollision[] } {
  if (normRules.length < 2) {
    return { sameGl: [], differentGl: [] };
  }

  const glGroups = groupByGlAccount(normRules);
  const sameGl: SameGlCollision[] = [];
  const differentGl: DifferentGlCollision[] = [];

  // Same-GL collisions: groups with >= 2 rules
  for (const [glId, group] of glGroups) {
    if (group.length < 2) continue;
    sortForSurvivor(group);
    const survivor = group[0];
    const toDeactivate = group.slice(1);
    sameGl.push({
      survivor,
      toDeactivate,
      glAccountId: glId === '__null__' ? '' : glId,
    });
  }

  // Different-GL collisions: at least 2 rules normalize to same pattern
  // but target different GL accounts
  const nonNullGlGroups = Array.from(glGroups.entries()).filter(([k]) => k !== '__null__');
  if (nonNullGlGroups.length >= 2) {
    const allRules = nonNullGlGroups.flatMap(([, g]) => g);
    const allGlIds = nonNullGlGroups.map(([k]) => k);
    differentGl.push({
      rules: allRules,
      glAccountIds: allGlIds,
    });
  }

  return { sameGl, differentGl };
}

function pickReason(rule: NormalizedRule): 'manual' | 'updatedAt' {
  return rule.rule.isManuallyEdited ? 'manual' : 'updatedAt';
}

// ── DB Writes ───────────────────────────────────────────────────────────────

async function applyNonCollisionUpdates(
  db: PrismaClient,
  updates: MigrationReport['updated'],
  batchSize: number,
): Promise<void> {
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await Promise.all(
      batch.map((u) =>
        db.bankRule.update({
          where: { id: u.ruleId },
          data: { conditionValue: u.newPattern },
        }),
      ),
    );
  }
}

async function applyConsolidation(
  db: PrismaClient,
  survivor: NormalizedRule,
  toDeactivate: NormalizedRule[],
  normalizedPattern: string,
): Promise<boolean> {
  try {
    await db.bankRule.update({
      where: { id: survivor.rule.id },
      data: { conditionValue: normalizedPattern },
    });

    for (const rule of toDeactivate) {
      await db.bankRule.update({
        where: { id: rule.rule.id },
        data: {
          conditionValue: rule.rule.conditionValue,
          isActive: false,
          entityContextId: null,
        },
      });

      await db.auditLog.create({
        data: {
          companyId: survivor.rule.companyId,
          action: 'RULE_COLLISION_RESOLVED',
          entity: 'BankRule',
          entityId: rule.rule.id,
          details: JSON.stringify({
            survivorRuleId: survivor.rule.id,
            normalizedPattern,
            reason: pickReason(survivor),
            previousPattern: rule.rule.conditionValue,
            previousGlAccountId: rule.rule.glAccountId,
          }),
        },
      });
    }

    return true;
  } catch {
    return false;
  }
}

async function logCriticalCollision(
  db: PrismaClient,
  differentGl: DifferentGlCollision,
  normalizedPattern: string,
  companyId: string,
): Promise<boolean> {
  try {
    await db.auditLog.create({
      data: {
        companyId,
        action: 'RULE_COLLISION_CRITICAL',
        entity: 'BankRule',
        details: JSON.stringify({
          normalizedPattern,
          ruleIds: differentGl.rules.map((r) => r.rule.id),
          glAccountIds: differentGl.glAccountIds,
          message: `CRITICAL: ${differentGl.rules.length} rules normalize to "${normalizedPattern}" but target different GL accounts. Human review required.`,
        }),
      },
    });
    return true;
  } catch {
    return false;
  }
}

// ── Report Writing ──────────────────────────────────────────────────────────

function writeReport(report: MigrationReport, outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[migration] Report written to ${outputPath}`);
}

// ── Logging ─────────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, extra?: Record<string, unknown>): void {
  const prefix = `[migration] [${level}]`;
  if (extra) {
    console.log(`${prefix} ${message}`, JSON.stringify(extra));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs();
  const db = new PrismaClient();
  const report: MigrationReport = initReport(options.dryRun);

  log('INFO', `Starting normalization migration (dryRun=${options.dryRun})`);

  // 1. Backup
  if (!options.dryRun) {
    try {
      const count = await backupBankRules(db, options.dump);
      log('INFO', `Backup saved to ${options.dump} (${count} records)`);
    } catch (err) {
      log('ERROR', `Backup failed: ${err}`);
      process.exit(1);
    }
  } else {
    log('INFO', 'Dry-run mode: backup skipped');
  }

  // 2. Fetch all rules grouped by company
  const rulesByCompany = await fetchRulesGroupedByCompany(db);

  for (const [companyId, rules] of rulesByCompany) {
    try {
      report.summary.totalRules += rules.length;

      const normalizedByPattern = new Map<string, NormalizedRule[]>();
      const companyUpdated: MigrationReport['updated'] = [];

      // 3. Normalize each rule
      for (const rule of rules) {
        try {
          const newPattern = normalizePattern(rule.conditionValue);

          if (newPattern === rule.conditionValue) {
            report.skipped.push({
              ruleId: rule.id,
              pattern: rule.conditionValue,
              companyId,
              reason: 'already_normalized',
            });
            report.summary.skipped++;
          } else {
            const entry: NormalizedRule = { rule, normalizedPattern: newPattern };
            companyUpdated.push({
              ruleId: rule.id,
              oldPattern: rule.conditionValue,
              newPattern,
              companyId,
            });

            const existing = normalizedByPattern.get(newPattern);
            if (existing) {
              existing.push(entry);
            } else {
              normalizedByPattern.set(newPattern, [entry]);
            }
          }
        } catch (err) {
          report.errors.push({
            ruleId: rule.id,
            pattern: rule.conditionValue,
            error: String(err),
          });
        }
      }

      // 4. Detect and resolve collisions
      const collisionRuleIds = new Set<string>();

      for (const [normPattern, normRules] of normalizedByPattern) {
        if (normRules.length < 2) continue;

        const { sameGl, differentGl } = detectCollisions(normRules);

        if (sameGl.length === 0 && differentGl.length === 0) continue;

        const collisionEntry: MigrationReport['collisions'][number] = {
          normalizedPattern: normPattern,
          companyId,
          sameGl: [],
          differentGl: [],
        };

        // Same-GL: consolidate
        for (const sg of sameGl) {
          const auditLogged = !options.dryRun
            ? await applyConsolidation(db, sg.survivor, sg.toDeactivate, normPattern)
            : false;

          // Mark survivor and deactivated IDs for exclusion from non-collision updates
          collisionRuleIds.add(sg.survivor.rule.id);
          for (const d of sg.toDeactivate) {
            collisionRuleIds.add(d.rule.id);
            collisionEntry.sameGl.push({
              survivorId: sg.survivor.rule.id,
              deactivatedId: d.rule.id,
              glAccountId: sg.glAccountId,
              reason: pickReason(sg.survivor),
              auditLogged,
            });
          }
          report.summary.collisions += sg.toDeactivate.length;
        }

        // Different-GL: CRITICAL
        for (const dg of differentGl) {
          // Mark all collision rule IDs (they get handled here, not in non-collision batch)
          for (const nr of dg.rules) {
            collisionRuleIds.add(nr.rule.id);
          }

          if (!options.dryRun) {
            // Update ALL rules to the normalized pattern
            for (const nr of dg.rules) {
              await db.bankRule.update({
                where: { id: nr.rule.id },
                data: { conditionValue: normPattern },
              });
            }
          }

          const criticalLogged = !options.dryRun
            ? await logCriticalCollision(db, dg, normPattern, companyId)
            : false;

          collisionEntry.differentGl.push({
            ruleIds: dg.rules.map((r) => r.rule.id),
            glAccountIds: dg.glAccountIds,
            criticalLogged,
          });
          report.summary.critical++;
        }

        report.collisions.push(collisionEntry);
      }

      // 5. Apply non-collision updates (skip in dry-run)
      const nonCollisionUpdates = companyUpdated.filter((u) => !collisionRuleIds.has(u.ruleId));
      if (!options.dryRun && nonCollisionUpdates.length > 0) {
        await applyNonCollisionUpdates(db, nonCollisionUpdates, options.batchSize);
        log('INFO', `Applied ${nonCollisionUpdates.length} non-collision updates for company ${companyId}`);
      }

      // Update summary
      report.summary.updated += companyUpdated.length;
      report.updated.push(...companyUpdated);
    } catch (err) {
      log('ERROR', `Company ${companyId} migration failed — skipping`, { error: String(err) });
    }
  }

  // 6. Write report
  writeReport(report, options.output);

  log('INFO', 'Migration complete — summary:', {
    totalRules: report.summary.totalRules,
    updated: report.summary.updated,
    skipped: report.summary.skipped,
    collisions: report.summary.collisions,
    critical: report.summary.critical,
    errors: report.errors.length,
  });

  // 7. Exit code: non-zero if NO rules processed successfully
  const anySuccess = report.summary.updated > 0 || report.summary.skipped > 0;
  if (!anySuccess) {
    log('ERROR', 'No rules were processed successfully — exiting with code 1');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[migration] Fatal error:', err);
  process.exit(1);
});
