import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { ValidationError } from '@/lib/api-error';
import { ImportService } from '@/services/import.service';
import { trackAPIResponseTime } from '@/lib/metrics';
import { requireCompanyContext } from '@/lib/context-storage';
import { validateFile } from '@/lib/file-validation';

// ─── POST /api/import ─────────────────────────────────────────────────
// Accepts multipart/form-data with a file field.
// Supports CSV, OFX, QFX, PDF formats.
export const POST = apiHandler(async (request: NextRequest) => {
  const { userId, companyId } = requireCompanyContext();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const bankAccountId = formData.get('bankAccountId') as string | null;
  const bypassHolderValidation = formData.get('bypassHolderValidation') === 'true';

  if (!file) {
    throw new ValidationError('No se subió ningún archivo. Proporcione un campo "file".');
  }

  // Validate file size (max 10 MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new ValidationError('El archivo es demasiado grande. El tamaño máximo es 10 MB.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = validateFile(file, buffer);
  const fileName = file.name;
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
