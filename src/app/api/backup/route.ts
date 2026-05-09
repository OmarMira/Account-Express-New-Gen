import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/sessions';
import { createBackup, listBackups, deleteBackup } from '@/lib/backup';
import { verifyCompanyAccess } from '@/lib/verify-access';
import { computeAuditHash } from '@/lib/journal-hash';
import { db } from '@/lib/db';

/**
 * POST /api/backup — Create a full backup for a company
 * Body: { companyId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { companyId } = body;

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
    }

    // Verify access
    const access = await verifyCompanyAccess(userId, companyId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    const result = await createBackup(companyId);

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ filename: result.filename, size: result.size, recordCounts: result.recordCounts });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId, userId, action: 'create_backup', entity: 'Company',
        entityId: companyId, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId, userId, action: 'create_backup', entity: 'Company',
      entityId: companyId, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({
      id: result.id,
      filename: result.filename,
      size: result.size,
      createdAt: result.createdAt,
      data: result.data,
      recordCounts: result.recordCounts,
    });
  } catch (error) {
    console.error('[BACKUP CREATE ERROR]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create backup' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/backup — List backups for a company
 * Query: ?companyId=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
    }

    // Verify access
    const access = await verifyCompanyAccess(userId, companyId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    const backups = listBackups(companyId);

    return NextResponse.json({ backups });
  } catch (error) {
    console.error('[BACKUP LIST ERROR]', error);
    return NextResponse.json({ error: 'Failed to list backups' }, { status: 500 });
  }
}

/**
 * DELETE /api/backup — Delete a specific backup
 * Body: { companyId: string, filename: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { companyId, filename } = body;

    if (!companyId || !filename) {
      return NextResponse.json({ error: 'companyId and filename are required' }, { status: 400 });
    }

    // Verify access
    const access = await verifyCompanyAccess(userId, companyId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    const success = deleteBackup(filename);

    if (!success) {
      return NextResponse.json({ error: 'Backup file not found' }, { status: 404 });
    }

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ filename });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId, userId, action: 'delete_backup', entity: 'Company',
        entityId: companyId, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId, userId, action: 'delete_backup', entity: 'Company',
      entityId: companyId, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({ success: true, message: 'Backup deleted' });
  } catch (error) {
    console.error('[BACKUP DELETE ERROR]', error);
    return NextResponse.json({ error: 'Failed to delete backup' }, { status: 500 });
  }
}
