import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Valida el cuerpo de una petición entrante contra un schema de Zod.
 *
 * @param req - La petición Request de Next.js
 * @param schema - Schema Zod para validar el cuerpo
 * @returns Los datos validados O una respuesta NextResponse con error 400
 *
 * @example
 * const result = await validateRequest(req, LoginSchema);
 * if (result instanceof NextResponse) return result; // Retorna el error
 * const { email, password } = result; // Datos seguros tipados
 */
export async function validateRequest<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<T | NextResponse> {
  try {
    const json = await req.json();
    const result = schema.safeParse(json);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.error.flatten() },
        { status: 400 },
      );
    }
    return result.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
