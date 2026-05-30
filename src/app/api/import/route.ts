import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { apiHandler } from '@/lib/api-handler';
import { AuthError, ForbiddenError, ValidationError } from '@/lib/api-error';
import { ImportService } from '@/services/import.service';
import { trackAPIResponseTime } from '@/lib/metrics';

// ─── POST /api/import ─────────────────────────────────────────────────
// Accepts multipart/form-data with a file field.
// Supports CSV, OFX, QFX, PDF formats.
export const POST = apiHandler(async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    throw new AuthError();
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const companyId = formData.get('companyId') as string | null;
  const bankAccountId = formData.get('bankAccountId') as string | null;
  const bypassHolderValidation = formData.get('bypassHolderValidation') === 'true';

  if (!file) {
    throw new ValidationError('No se subió ningún archivo. Proporcione un campo "file".');
  }

  if (!companyId) {
    throw new ValidationError('El companyId es requerido.');
  }

  // Verify membership
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) {
    throw new ForbiddenError();
  }

  // Validate file size (max 10 MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new ValidationError('El archivo es demasiado grande. El tamaño máximo es 10 MB.');
  }

  const fileName = file.name;
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const buffer = Buffer.from(await file.arrayBuffer());
  const content = buffer.toString('utf-8');

  const importStart = performance.now();
  const result = await ImportService.importFile({
    companyId,
    bankAccountId,
    fileName,
    extension,
    buffer,
    content,
    userId,
    bypassHolderValidation,
  });
  trackAPIResponseTime('ImportService.importFile', 'POST', performance.now() - importStart);

  return NextResponse.json(result);
});
