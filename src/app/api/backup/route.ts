import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { createBackup, listBackups, deleteBackup } from '@/lib/backup';

/**
 * POST /api/backup — Create a full backup for a company
 * Body: { companyId: string }
 */
export const POST = apiHandler(async (request: NextRequest, context: { params: any }) => {
  const { companyId } = requireCompanyContext();

  const result = await createBackup(companyId);

  return NextResponse.json({
    id: result.id,
    filename: result.filename,
    size: result.size,
    createdAt: result.createdAt,
    data: result.data,
    recordCounts: result.recordCounts,
  });
});

/**
 * GET /api/backup — List backups for a company
 * Query: ?companyId=xxx
 */
export const GET = apiHandler(async (request: NextRequest, context: { params: any }) => {
  const { companyId } = requireCompanyContext();

  const backups = listBackups(companyId);

  return NextResponse.json({ backups });
});

/**
 * DELETE /api/backup — Delete a specific backup
 * Body: { companyId: string, filename: string }
 */
export const DELETE = apiHandler(async (request: NextRequest, context: { params: any }) => {
  const { companyId } = requireCompanyContext();
  const body = await request.json();
  const { filename } = body;

  if (!filename) {
    return NextResponse.json({ error: 'companyId and filename are required' }, { status: 400 });
  }

  const success = deleteBackup(filename);

  if (!success) {
    return NextResponse.json({ error: 'Backup file not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, message: 'Backup deleted' });
});
