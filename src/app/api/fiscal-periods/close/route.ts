import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { executeYearClose } from '@/services/closing-engine';
import { fiscalConfigSchema } from '@/lib/fiscal-period/types';

export const POST = apiHandler(async (req: NextRequest) => {
  const { companyId, year, config } = await req.json();

  if (!companyId || !year || !config) {
    return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 });
  }

  const validatedConfig = fiscalConfigSchema.parse(config);

  try {
    const result = await executeYearClose(companyId, year, validatedConfig);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[YEAR CLOSE API ERROR]', error);
    return NextResponse.json(
      { error: error.message || 'Error en el cierre de ejercicio' },
      { status: 500 },
    );
  }
});
