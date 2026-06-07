/**
 * Validador semántico contable.
 * Evalúa la coherencia entre la clase de cuenta (Patrimonio, Ingresos, Gastos/Costos),
 * el tipo de movimiento (débito/crédito) y la descripción del movimiento.
 */
export function validateSemanticDirection(
  glAccountCode: string,
  direction: 'debit' | 'credit',
  description: string,
): string | null {
  if (!glAccountCode || !direction || !description) {
    return null;
  }

  const descLower = description.toLowerCase();

  // Clase 3: Patrimonio
  if (glAccountCode.startsWith('3')) {
    if (direction === 'debit') {
      const keywords = [
        'retiro',
        'socio',
        'capital',
        'draw',
        'partner',
        'owner',
        'distribucion',
        'dividendo',
        'utilidades',
        'aporte',
        'disminucion',
      ];
      const hasKeyword = keywords.some((kw) => descLower.includes(kw));
      if (!hasKeyword) {
        return 'Advertencia semántica: La cuenta de patrimonio (Clase 3) registra un débito pero la descripción no contiene palabras clave asociadas a retiro, socio o disminución de capital.';
      }
    }
  }

  // Clase 4: Ingresos
  else if (glAccountCode.startsWith('4')) {
    if (direction === 'debit') {
      const keywords = [
        'devolucion',
        'reembolso',
        'refund',
        'return',
        'cancelacion',
        'extorno',
        'rebaja',
        'descuento',
        'ajuste',
      ];
      const hasKeyword = keywords.some((kw) => descLower.includes(kw));
      if (!hasKeyword) {
        return 'Advertencia semántica: La cuenta de ingresos (Clase 4) registra un débito pero la descripción no contiene palabras clave de devolución, reembolso o descuento.';
      }
    }
  }

  // Clases 5 y 6: Gastos y Costos
  else if (glAccountCode.startsWith('5') || glAccountCode.startsWith('6')) {
    if (direction === 'credit') {
      const keywords = [
        'reembolso',
        'abono',
        'refund',
        'credit',
        'ajuste',
        'devolucion',
        'extorno',
        'reversar',
        'nota de credito',
      ];
      const hasKeyword = keywords.some((kw) => descLower.includes(kw));
      if (!hasKeyword) {
        return 'Advertencia semántica: La cuenta de gastos o costos (Clase 5/6) registra un crédito pero la descripción no contiene palabras clave de reembolso, abono o ajuste.';
      }
    }
  }

  return null;
}
