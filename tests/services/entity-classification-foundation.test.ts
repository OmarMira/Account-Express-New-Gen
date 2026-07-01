import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearDatabase, createTestCompany, createTestGlAccount } from '../helpers/factories';
import { saveContext } from '@/lib/services/entity-context-service';
import { db } from '@/lib/db';

describe('human-confirmed classification foundation', () => {
  it('stores pending-review contexts with no final role and nullable confidence', async () => {
    await clearDatabase();
    const company = await createTestCompany('Classification Foundation Co');

    const context = await saveContext({
      companyId: company.id,
      pattern: 'LEGACY UNCERTAIN ENTITY',
      role: null,
      classificationStatus: 'PENDING_REVIEW',
      classificationConfidence: null,
      userDescription: 'operator said this needs review',
    });

    expect(context.role).toBeNull();
    expect(context.classificationStatus).toBe('PENDING_REVIEW');
    expect(context.classificationConfidence).toBeNull();
    expect(context.userDescription).toBe('operator said this needs review');
  });

  it('stores confirmed contexts with confidence when explicitly provided', async () => {
    await clearDatabase();
    const company = await createTestCompany('Confirmed Classification Co');

    const context = await saveContext({
      companyId: company.id,
      pattern: 'CONFIRMED VENDOR',
      role: 'PROVEEDOR',
      classificationStatus: 'CONFIRMED',
      classificationConfidence: 0.91,
    });

    expect(context.role).toBe('PROVEEDOR');
    expect(context.classificationStatus).toBe('CONFIRMED');
    expect(context.classificationConfidence).toBeCloseTo(0.91);
  });

  it('preserves linked account data while marking uncertainty as pending review', async () => {
    await clearDatabase();
    const company = await createTestCompany('Linked Review Co');
    const glAccount = await createTestGlAccount({
      companyId: company.id,
      code: '6099',
      name: 'Needs Review Expense',
    });

    const context = await saveContext({
      companyId: company.id,
      pattern: 'LINKED LEGACY ENTITY',
      role: null,
      classificationStatus: 'PENDING_REVIEW',
      glAccountId: glAccount.id,
      userDescription: 'legacy linked account should remain visible',
    });

    const persisted = await db.entityContext.findUnique({
      where: { id: context.id },
      include: { glAccount: true },
    });

    expect(persisted?.classificationStatus).toBe('PENDING_REVIEW');
    expect(persisted?.role).toBeNull();
    expect(persisted?.glAccountId).toBe(glAccount.id);
    expect(persisted?.glAccount?.code).toBe('6099');
  });
});

describe('legacy OTRO migration', () => {
  const migrationSql = () =>
    readFileSync(
      join(
        process.cwd(),
        'prisma',
        'migrations',
        '20260701120000_hcsc_foundation',
        'migration.sql',
      ),
      'utf8',
    );

  it('converts legacy OTRO contexts to pending review without losing descriptive fields', () => {
    const sql = migrationSql();

    expect(sql).toContain('ALTER COLUMN "role" DROP NOT NULL');
    expect(sql).toContain('"classificationStatus"');
    expect(sql).toContain('"classificationConfidence"');
    expect(sql).toMatch(/SET\s+"role"\s+=\s+NULL/i);
    expect(sql).toMatch(/"classificationStatus"\s+=\s+'PENDING_REVIEW'/i);
    expect(sql).toMatch(/WHERE\s+"role"\s+=\s+'OTRO'/i);
    expect(sql).not.toMatch(/"userDescription"\s+=\s+NULL/i);
    expect(sql).not.toMatch(/"glAccountId"\s+=\s+NULL/i);
  });

  it('does not mutate BankRule rows during legacy OTRO migration', () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/UPDATE\s+"BankRule"/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"BankRule"/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"BankRule"/i);
  });
});
