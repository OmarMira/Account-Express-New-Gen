/**
 * Detecta si una cadena contiene patrones sospechosos de XSS.
 * No altera ni transforma el contenido original para preservar comillas, apóstrofes u otros
 * caracteres financieros válidos (como las descripciones de Bank of America).
 */
export function hasXssPattern(value: string): boolean {
  const xssPatterns = [
    /<script/i,
    /javascript:/i,
    /onerror\s*=/i,
    /onload\s*=/i,
    /onclick\s*=/i,
    /onmouseover\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<\/script>/i,
  ];
  return xssPatterns.some((pattern) => pattern.test(value));
}
