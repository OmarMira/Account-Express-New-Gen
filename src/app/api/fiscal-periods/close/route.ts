import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { executeYearClose } from '@/lib/services/closing-engine';
import { fiscalConfigSchema } from '@/lib/fiscal-period/types';
import { logger } from '@/lib/logger';

export const POST = apiHandler(async (req: NextRequest) => {
  const { companyId, year, config } = await req.json();

  if (!companyId || !year || !config) {
    return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 });
  }

  const validatedConfig = fiscalConfigSchema.parse(config);

  try {
    const result = await executeYearClose(companyId, year, validatedConfig);
    return NextResponse.json(result);
  } catch (error: unknown) {
    logger.error('[YEAR CLOSE API ERROR]', { error: String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
