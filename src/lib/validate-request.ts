import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasXssPattern } from './sanitize';

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
  // Endpoints that do NOT require body validation (e.g., logout, backup upload)
  const skipValidationPaths = ['/api/auth/logout', '/api/backup/upload'];

  const url = new URL(req.url);
  if (skipValidationPaths.includes(url.pathname)) {
    // Return raw JSON body without schema validation
    try {
      return (await req.json()) as unknown as T;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }

  try {
    const json = await req.json();
    // Recursive XSS detection
    const checkXss = (obj: any) => {
      if (typeof obj === 'string' && hasXssPattern(obj)) {
        throw new Error('Potential XSS attack detected');
      }
      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          checkXss(obj[key]);
        }
      }
    };
    checkXss(json);
    const result = schema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.error.flatten() },
        { status: 400 },
      );
    }
    return result.data;
  } catch (err: any) {
    if (err.message === 'Potential XSS attack detected') {
      throw err;
    }
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
