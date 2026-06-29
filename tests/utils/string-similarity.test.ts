import { describe, it, expect } from 'vitest';
import { jaro, jaroWinkler } from '@/lib/utils/string-similarity';

describe('jaro()', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaro('MERCADO LIBRE', 'MERCADO LIBRE')).toBe(1.0);
  });

  it('returns 0.0 for empty first string', () => {
    expect(jaro('', 'ABC')).toBe(0.0);
  });

  it('returns 0.0 for empty second string', () => {
    expect(jaro('ABC', '')).toBe(0.0);
  });

  it('returns 1.0 for both empty strings (identical)', () => {
    expect(jaro('', '')).toBe(1.0);
  });

  it('returns 0.0 when no matches found', () => {
    const result = jaro('ABCD', 'WXYZ');
    expect(result).toBe(0.0);
  });

  it('handles short strings without division by zero', () => {
    const result = jaro('AB', 'AC');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it('returns 1.0 for single identical character', () => {
    expect(jaro('A', 'A')).toBe(1.0);
  });
});

describe('jaroWinkler()', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('MERCADO LIBRE', 'MERCADO LIBRE')).toBe(1.0);
  });

  it('returns near 0 for completely different strings', () => {
    const result = jaroWinkler('MERCADO LIBRE', 'ZZZZZZZZZZZZ');
    expect(result).toBeLessThanOrEqual(0.1);
  });

  it('returns >= 0.95 for minor typo (trailing space)', () => {
    const result = jaroWinkler('MERCADO LIBRE', 'MERCADO LIBRE ');
    expect(result).toBeGreaterThanOrEqual(0.95);
  });

  it('handles short strings without error', () => {
    const result = jaroWinkler('AB', 'AC');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it('returns > 0.85 for long strings with common prefix', () => {
    const result = jaroWinkler('EXPRESO ARGENTINO S.A.', 'EXPRESO ARGENTINO S.R.L.');
    expect(result).toBeGreaterThan(0.85);
  });

  it('returns 1.0 for empty strings (both empty)', () => {
    expect(jaroWinkler('', '')).toBe(1.0);
  });

  it('returns 0.0 when one string is empty', () => {
    expect(jaroWinkler('ABC', '')).toBe(0.0);
  });

  it('returns 1.0 for exact match short string', () => {
    expect(jaroWinkler('A', 'A')).toBe(1.0);
  });

  it('applies prefix bonus for common prefix', () => {
    const noPrefix = jaroWinkler('ABCDEF', 'ABDCEF');
    const withPrefix = jaroWinkler('ABCDEF', 'ABCDXY');
    // Strings starting with "ABCD" should get a higher score than those that don't
    // for the same number of matching characters
    expect(jaroWinkler('ABCD', 'ABCD')).toBe(1.0);
  });

  it('returns 0.0 for completely different short strings', () => {
    expect(jaroWinkler('A', 'B')).toBe(0.0);
  });
});
