import sanitizeHtml from 'sanitize-html';

/**
 * Sanitiza una cadena eliminando cualquier tag HTML o atributo peligroso.
 * Permite texto plano completo, manteniendo comillas y caracteres especiales.
 */
export function sanitizeInput(value: string): string {
  if (!value) return value;
  
  return sanitizeHtml(value, {
    allowedTags: [], // No HTML allowed at all
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    textFilter: function(text) {
      // sanitize-html will unescape HTML entities by default in textFilter if we aren't careful, 
      // but if allowedTags is empty, it just strips tags.
      return text;
    }
  });
}
