import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as backupPOST, GET as backupGET, DELETE as backupDELETE } from '../../src/app/api/backup/route';
import { POST as restorePOST } from '../../src/app/api/backup/restore/route';
import { createTestUser, createTestCompany, createTestCompanyMember, createTestGlAccount, createTestBankAccount, createTestBankStatement, createTestBankTransaction, createTestJournalEntry, clearDatabase } from '../helpers/factories';
import { createSession } from '@/lib/sessions';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BACKUP_DIR = path.join(process.cwd(), 'db', 'backups');

function cleanBackupDir() {
  if (fs.existsSync(BACKUP_DIR)) {
    const files = fs.readdirSync(BACKUP_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(BACKUP_DIR, file));
    }
  }
}

describe('POST /api/backup + POST /api/backup/restore', () => {
  beforeEach(async () => {
    await clearDatabase();
    cleanBackupDir();
  });

  afterEach(async () => {
    await clearDatabase();
    cleanBackupDir();
  });

  async function createTestFixture(companyId: string) {
    const gl = await createTestGlAccount({
      companyId,
      code: '1010',
      name: 'Cash',
      accountType: 'asset',
      normalBalance: 'debit',
    });
    const bankAccount = await createTestBankAccount(companyId, gl.id, 'Test Bank');
    const statement = await createTestBankStatement(companyId, bankAccount.id);
    await createTestBankTransaction(companyId, statement.id, {
      date: '2025-03-15',
      amount: 500.0,
      description: 'Test deposit',
      reference: 'REF-001',
    });
    await createTestJournalEntry(companyId, {
      date: '2025-03-15',
      description: 'Test entry',
      lines: [
        { glAccountId: gl.id, debit: 500, credit: 0 },
        { glAccountId: gl.id, debit: 0, credit: 500 },
      ],
    });
    return { gl, bankAccount, statement };
  }

  it('debe crear un backup con datos de prueba y restaurarlo correctamente', async () => {
    const user = await createTestUser('backup-full@example.com');
    const company = await createTestCompany('Backup Full Test');
    await createTestCompanyMember(user.id, company.id);
    const token = await createSession(user.id);
    await createTestFixture(company.id);

    // Create backup
    const backupReq = new NextRequest(`http://localhost/api/backup?companyId=${company.id}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const backupRes = await backupPOST(backupReq, { params: Promise.resolve({}) });
    expect(backupRes.status).toBe(200);

    const backupBody = await backupRes.json();
    expect(backupBody.filename).toContain(company.id);
    expect(backupBody.recordCounts.glAccounts).toBeGreaterThanOrEqual(1);
    expect(backupBody.recordCounts.bankAccounts).toBe(1);
    expect(backupBody.recordCounts.bankTransactions).toBe(1);
    expect(backupBody.recordCounts.journalEntries).toBe(1);

    // Record counts before clear
    const backupData = backupBody.data;

    // Clear company data
    await clearDatabase();

    // Verify company is gone
    const deletedCompany = await db.company.findUnique({ where: { id: company.id } });
    expect(deletedCompany).toBeNull();

    // Recreate company + fresh user + session for restore (clearDatabase wipes all)
    const restoreUser = await createTestUser('backup-restore@example.com');
    await db.company.create({
      data: {
        id: company.id,
        legalName: 'Backup Full Test',
        entityType: 'BUSINESS',
        taxId: '12-3456789',
      },
    });
    await createTestCompanyMember(restoreUser.id, company.id);
    const restoreToken = await createSession(restoreUser.id);

    // Restore from backup
    const restoreReq = new NextRequest(`http://localhost/api/backup/restore?companyId=${company.id}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${restoreToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: backupData }),
    });
    const restoreRes = await restorePOST(restoreReq, { params: Promise.resolve({}) });
    expect(restoreRes.status).toBe(200);

    const restoreBody = await restoreRes.json();
    expect(restoreBody.success).toBe(true);

    // Verify company is back
    const restoredCompany = await db.company.findUnique({ where: { id: company.id } });
    expect(restoredCompany).not.toBeNull();
    expect(restoredCompany?.legalName).toBe('Backup Full Test');

    // Verify GL accounts restored
    const glAccounts = await db.glAccount.findMany({ where: { companyId: company.id } });
    expect(glAccounts.length).toBeGreaterThanOrEqual(1);

    // Verify bank accounts restored
    const bankAccounts = await db.bankAccount.findMany({ where: { companyId: company.id } });
    expect(bankAccounts.length).toBe(1);

    // Verify transactions restored
    const statements = await db.bankStatement.findMany({ where: { companyId: company.id } });
    const statementIds = statements.map((s) => s.id);
    const transactions = await db.bankTransaction.findMany({ where: { statementId: { in: statementIds } } });
    expect(transactions.length).toBe(1);
    expect(transactions[0].reference).toBe('REF-001');

    // Verify journal entries restored
    const entries = await db.journalEntry.findMany({ where: { companyId: company.id } });
    expect(entries.length).toBe(1);
  });

  it('debe rechazar restauracion con backup de otra empresa', async () => {
    const user = await createTestUser('backup-cross@example.com');
    const companyA = await createTestCompany('Company A');
    const companyB = await createTestCompany('Company B');
    await createTestCompanyMember(user.id, companyA.id);
    await createTestCompanyMember(user.id, companyB.id);
    const token = await createSession(user.id);

    // Create data in company A
    await createTestFixture(companyA.id);

    // Backup company A
    const backupReq = new NextRequest(`http://localhost/api/backup?companyId=${companyA.id}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const backupRes = await backupPOST(backupReq, { params: Promise.resolve({}) });
    const backupBody = await backupRes.json();

    // Try to restore company A backup into company B
    const restoreReq = new NextRequest(`http://localhost/api/backup/restore?companyId=${companyB.id}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: backupBody.data }),
    });
    const restoreRes = await restorePOST(restoreReq, { params: Promise.resolve({}) });
    expect(restoreRes.status).toBe(400);

    const restoreBody = await restoreRes.json();
    expect(restoreBody.error).toContain('does not match');
  });

  it('debe rechazar datos de backup invalidos', async () => {
    const user = await createTestUser('backup-invalid@example.com');
    const company = await createTestCompany('Invalid Backup');
    await createTestCompanyMember(user.id, company.id);
    const token = await createSession(user.id);

    const invalidBase64 = Buffer.from('{"invalid": true}').toString('base64');

    const restoreReq = new NextRequest(`http://localhost/api/backup/restore?companyId=${company.id}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: invalidBase64 }),
    });
    const restoreRes = await restorePOST(restoreReq, { params: Promise.resolve({}) });
    expect(restoreRes.status).toBe(400);
  });

  it('debe listar backups de una empresa', async () => {
    const user = await createTestUser('backup-list@example.com');
    const company = await createTestCompany('List Backup');
    await createTestCompanyMember(user.id, company.id);
    const token = await createSession(user.id);

    // Create 2 backups
    for (let i = 0; i < 2; i++) {
      const req = new NextRequest(`http://localhost/api/backup?companyId=${company.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      await backupPOST(req, { params: Promise.resolve({}) });
    }

    const listReq = new NextRequest(`http://localhost/api/backup?companyId=${company.id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const listRes = await backupGET(listReq, { params: Promise.resolve({}) });
    expect(listRes.status).toBe(200);

    const listBody = await listRes.json();
    expect(listBody.backups.length).toBe(2);
    expect(listBody.backups[0].filename).toContain(company.id);
  });

  it('ownership check: debe rechazar eliminacion de backup de otra empresa', async () => {
    const user = await createTestUser('backup-owner@example.com');
    const company = await createTestCompany('Owner Check');
    await createTestCompanyMember(user.id, company.id);
    const token = await createSession(user.id);

    const req = new NextRequest(`http://localhost/api/backup?companyId=${company.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filename: 'other-company_id_test.json' }),
    });
    const res = await backupDELETE(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });
});
