import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/sessions';
import { restoreBackup, validateBackup, type BackupData } from '@/lib/backup';
import { verifyCompanyAccess } from '@/lib/verify-access';
import { computeAuditHash } from '@/lib/journal-hash';
import { db } from '@/lib/db';

/**
 * POST /api/backup/restore — Restore from backup
 * Body (JSON): { companyId: string, data: string (base64) }
 * Body (FormData): companyId (field) + file (File attachment)
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let companyId: string;
    let backupData: BackupData;

    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData upload
      const formData = await request.formData();
      companyId = formData.get('companyId') as string;

      if (!companyId) {
        return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
      }

      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
      }

      // Verify access
      const access = await verifyCompanyAccess(userId, companyId);
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }

      const fileBuffer = await file.arrayBuffer();
      const jsonString = new TextDecoder().decode(fileBuffer);

      try {
        backupData = JSON.parse(jsonString) as BackupData;
      } catch {
        return NextResponse.json({ error: 'Invalid backup file: not valid JSON' }, { status: 400 });
      }
    } else {
      // Handle JSON body with base64 data
      const body = await request.json();
      companyId = body.companyId;
      const base64Data = body.data;

      if (!companyId || !base64Data) {
        return NextResponse.json({ error: 'companyId and data are required' }, { status: 400 });
      }

      // Verify access
      const access = await verifyCompanyAccess(userId, companyId);
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: 403 });
      }

      try {
        const jsonString = Buffer.from(base64Data, 'base64').toString('utf-8');
        backupData = JSON.parse(jsonString) as BackupData;
      } catch {
        return NextResponse.json({ error: 'Invalid backup data: not valid base64/JSON' }, { status: 400 });
      }
    }

    // Validate backup structure
    const validation = validateBackup(backupData);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Invalid backup: ${validation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    // Execute restore
    const result = await restoreBackup(companyId, backupData);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ restoredCounts: result.restoredCounts, message: result.message });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId, userId, action: 'restore_backup', entity: 'Company',
        entityId: companyId, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId, userId, action: 'restore_backup', entity: 'Company',
      entityId: companyId, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({
      success: true,
      message: result.message,
      restoredCounts: result.restoredCounts,
    });
  } catch (error) {
    console.error('[BACKUP RESTORE ERROR]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to restore backup' },
      { status: 500 }
    );
  }
}
