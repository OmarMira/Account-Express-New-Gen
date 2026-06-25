/**
 * Sanitiza una cadena eliminando cualquier tag HTML.
 * NO HTML-escapa entidades — React ya escapa en el frontend,
 * y escapar en el servidor rompe caracteres como &, <, > en los datos.
 */
export function sanitizeInput(value: string): string {
  if (!value) return value;
  // Solo remueve tags HTML, preserva el texto exacto
  return value.replace(/<[^>]*>/g, '');
}
