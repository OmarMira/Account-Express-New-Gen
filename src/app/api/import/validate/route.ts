import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { apiHandler } from '@/lib/api-handler';
import { AuthError, ForbiddenError, ValidationError } from '@/lib/api-error';
import { parsePDFAsync } from '@/lib/pdf-processor';
import {
  validateAccountHolder,
  isStrictModeEnabled,
} from '@/lib/validation/account-holder-validator';

export const POST = apiHandler(async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    throw new AuthError();
  }

  const formData = await request.formData();
  const companyId = formData.get('companyId') as string | null;
  const files = formData.getAll('files') as File[];

  if (!companyId) {
    throw new ValidationError('El companyId es requerido.');
  }

  if (!files || files.length === 0) {
    throw new ValidationError('Se requieren uno o más archivos para validar.');
  }

  // Verify company membership
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
    include: { company: true },
  });
  if (!membership) {
    throw new ForbiddenError();
  }

  const companyName = membership.company.legalName;
  const results: any[] = [];

  for (const file of files) {
    const fileName = file.name;
    const extension = fileName.split('.').pop()?.toLowerCase() || '';

    if (extension !== 'pdf') {
      // Non-PDF files are approved by default as they don't contain holder name metadata in standard text form
      results.push({
        fileName,
        extension,
        extractedHolder: 'N/A',
        companyName,
        score: 1.0,
        matches: true,
        requiresApproval: false,
      });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await parsePDFAsync(buffer);
      const extractedHolder = parsed.accountHolder || '';

      const validation = validateAccountHolder(extractedHolder, companyName);

      results.push({
        fileName,
        extension,
        extractedHolder: extractedHolder || 'No detectado',
        companyName,
        score: Math.round(validation.score * 100) / 100,
        matches: validation.matches,
        requiresApproval: validation.requiresApproval,
      });
    } catch (err: any) {
      results.push({
        fileName,
        extension,
        extractedHolder: 'Error al parsear PDF',
        companyName,
        score: 0.0,
        matches: false,
        requiresApproval: true,
        error: err.message || 'Error de parseo',
      });
    }
  }

  return NextResponse.json({ results, strictMode: isStrictModeEnabled() });
});
