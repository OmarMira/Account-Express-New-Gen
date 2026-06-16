import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sanitizeInput } from './sanitize';

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
  // Endpoints that do NOT require body validation (e.g., logout)
  const skipValidationPaths = ['/api/auth/logout'];

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
    // Recursive XSS sanitization in-place
    const sanitizeObj = (obj: unknown): unknown => {
      if (typeof obj === 'string') {
        return sanitizeInput(obj);
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObj);
      }
      if (obj && typeof obj === 'object') {
        const cleaned: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(obj)) {
          cleaned[key] = sanitizeObj(val);
        }
        return cleaned;
      }
      return obj;
    };
    
    const sanitizedJson = sanitizeObj(json);
    const result = schema.safeParse(sanitizedJson);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.error.flatten() },
        { status: 400 },
      );
    }
    return result.data;
  } catch (err: unknown) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
