import { describe, it, expect } from 'vitest';
import { normalizePattern } from '@/lib/services/pattern-normalizer';

describe('normalizePattern — canonical pure function', () => {
  it('1. trims and collapses whitespace', () => {
    expect(normalizePattern('  INTERES  BANCARIO  ')).toBe('interes bancario');
  });

  it('2. collapses tabs and newlines', () => {
    expect(normalizePattern('ACME\tCORP\nSA')).toBe('acme corp sa');
  });

  it('3. strips punctuation', () => {
    expect(normalizePattern('MERCADO LIBRE S.A. - (CUIT 30-...)')).toBe('mercado libre sa cuit 30');
  });

  it('4. preserves unicode characters', () => {
    expect(normalizePattern('Café Martínez')).toBe('café martínez');
  });

  it('5. returns empty string for empty input', () => {
    expect(normalizePattern('')).toBe('');
  });

  it('6. returns empty string when input is only punctuation', () => {
    expect(normalizePattern('!@#$%^&*()')).toBe('');
  });

  it('7. strips punctuation from numeric strings', () => {
    expect(normalizePattern('1234-5678/90')).toBe('1234567890');
  });

  it('8. does NOT strip bank metadata prefixes (pure function)', () => {
    expect(normalizePattern('INDN: ACME CORP')).toBe('indn acme corp');
  });

  it('9. trims leading and trailing spaces', () => {
    expect(normalizePattern('  hello world  ')).toBe('hello world');
  });

  it('10. collapses multiple internal spaces to one', () => {
    expect(normalizePattern('a    b')).toBe('a b');
  });

  it('11. is a pure function — no global state mutation', () => {
    const input = '  TEST  INPUT  ';
    const first = normalizePattern(input);
    const second = normalizePattern(input);
    expect(first).toBe(second);
    // Input unchanged
    expect(input).toBe('  TEST  INPUT  ');
  });

  it('12. strips hyphens', () => {
    expect(normalizePattern('well-known')).toBe('wellknown');
  });

  it('13. strips apostrophes', () => {
    expect(normalizePattern("O'Brien")).toBe('obrien');
  });

  it('14. repeated collapse after punctuation removal', () => {
    expect(normalizePattern('a , b')).toBe('a b');
  });

  it('15. returns empty string when input is only whitespace', () => {
    expect(normalizePattern('   ')).toBe('');
  });

  it('16. handles mixed unicode and punctuation', () => {
    expect(normalizePattern('Señor López, S.A. — ¡Hola!')).toBe('señor lópez sa hola');
  });
});
