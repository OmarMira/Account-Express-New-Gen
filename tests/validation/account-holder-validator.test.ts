import { describe, it, expect } from 'vitest';
import { validateAccountHolder } from '../../src/lib/validation/account-holder-validator';

describe('validateAccountHolder', () => {
  it('should match perfectly equal names', () => {
    const result = validateAccountHolder('LQ & OM LLC', 'LQ & OM LLC');
    expect(result.matches).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.requiresApproval).toBe(false);
  });

  it('should match with slight punctuation differences and whitespace variations', () => {
    const result = validateAccountHolder('LQ&OM LLC', 'LQ & OM LLC');
    expect(result.matches).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.requiresApproval).toBe(false);
  });

  it('should require approval for completely different names', () => {
    const result = validateAccountHolder('ANOTHER COMPANY INC', 'LQ & OM LLC');
    expect(result.matches).toBe(false);
    expect(result.score).toBeLessThan(0.5);
    expect(result.requiresApproval).toBe(true);
  });

  it('should fallback to require approval on empty values', () => {
    const result = validateAccountHolder('', 'LQ & OM LLC');
    expect(result.matches).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });
});
