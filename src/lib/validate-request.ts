import { NextRequest } from 'next/server';
import { ZodSchema } from 'zod';
import { ValidationError } from './api-error';
import { hasXssPattern } from './sanitize';

function checkXssRecursive(data: any, path: string[] = []): void {
  if (typeof data === 'string') {
    if (hasXssPattern(data)) {
      throw new ValidationError(
        `Potential XSS attack detected in field: ${path.join('.') || 'body'}`,
      );
    }
  } else if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      checkXssRecursive(data[i], [...path, i.toString()]);
    }
  } else if (data !== null && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      checkXssRecursive(data[key], [...path, key]);
    }
  }
}

export async function validateRequest<T>(request: NextRequest, schema: ZodSchema<T>): Promise<T> {
  try {
    let body: any;
    try {
      body = await request.clone().json();
    } catch {
      throw new ValidationError('Invalid JSON body');
    }

    // Comprobar XSS antes de validar el esquema
    checkXssRecursive(body);

    const result = schema.safeParse(body);
    if (!result.success) {
      // Map Zod errors to a clean, user-friendly object
      const formattedErrors = result.error.issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new ValidationError('Validation failed', formattedErrors);
    }

    return result.data;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(error instanceof Error ? error.message : 'Unknown validation error');
  }
}
