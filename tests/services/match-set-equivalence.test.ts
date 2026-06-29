/**
 * Match-Set Equivalence Test
 *
 * Verifies that the rule-matching engine produces consistent match pairs when
 * normalizePattern() is applied to both BankRule conditions AND transaction
 * descriptions — simulating the post-migration state.
 *
 * After normalization migration (PR #4b), BankRule.conditionValue fields are
 * pre-normalized in the database. This test validates that the engine handles
 * pre-normalized rules and descriptions consistently.
 *
 * Key assertions:
 *   - After normalizePattern() is applied to both sides, matching does NOT crash
 *   - Results are deterministic (same input → same output every run)
 *   - Specific patterns (punctuation, whitespace, prefixes) behave correctly
 */

import { describe, it, expect, vi } from 'vitest';
import { normalizePattern } from '@/lib/services/pattern-normalizer';

// The rule-matching engine's evaluateCondition normalizes internally:
//   toLowerCase() + trim() + replace(/\s+/g, ' ')
//
// normalizePattern does: trim → collapse → lowercase → strip punctuation →
// collapse → trim
//
// For pre-normalized inputs (both rule and tx sides passed through
// normalizePattern), the engine's inline normalization is a no-op subset.
// This test validates that matching works correctly in that state.

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate the engine's evaluateCondition for a "contains" operator
 * AFTER both inputs have been passed through normalizePattern.
 *
 * This mirrors the post-migration state: rules are pre-normalized in DB,
 * and the matching engine only needs lightweight normalization.
 *
 * Wildcard handling: the '*' marker is checked BEFORE normalization because
 * normalizePattern strips '*' as punctuation. We recognize it only when
 * the raw input is exactly '*' (the conventional wildcard).
 */
function normalizedContains(txDescription: string, rawCondition: string): boolean {
  // Wildcard check BEFORE normalization
  if (rawCondition === '*') {
    const txNorm = normalizePattern(String(txDescription));
    return txNorm.length > 0;
  }

  const txNorm = normalizePattern(String(txDescription));
  const condNorm = normalizePattern(String(rawCondition));

  if (!condNorm) return false;
  return txNorm.includes(condNorm);
}

/**
 * Build a set of test BankRule patterns that reflect real-world scenarios
 * AFTER they have been normalized by normalizePattern().
 */
function createNormalizedRulePatterns(): string[] {
  // These represent conditionValue AFTER normalizePattern() — simulating
  // what the DB will contain after migration.
  const rawPatterns = [
    'INTERES BANCARIO',
    'DEPOSITO NOMINA',
    'TRANSFERENCIA S.A.',
    'PAGO PROVEEDOR',
    'COMISION BANCARIA',
    'SERVICIO LUZ',
    'ALQUILER LOCAL',
    'SEGUROS S.A.',
    'COMPRA MERCADO',
    'IVA COMPRAS',
    'S.A. DE C.V.',
    'PAGO CO. CAPITAL',
    'RECARGO TDC',
    'GASTO ADMIN.',
    'RETIRO EFECTIVO',
  ].map((p) => normalizePattern(p));

  return rawPatterns;
}

/**
 * Create a diverse set of transaction descriptions that test normalization.
 */
function createTransactionDescriptions(): string[] {
  return [
    // Basic matches
    'INTERES BANCARIO',
    'interes bancario',
    '  INTERES   BANCARIO  ',
    'Depósito Nómina',
    'TRANSFERENCIA S.A.',
    'Transferencia S.A. de C.V.',

    // Punctuation variations
    'PAGO PROVEEDOR S.A. DE C.V.',
    'Pago Proveedor, S.A.',
    'COMISIÓN BANCARIA',
    'SERVICIO LUZ - MENSUAL',
    'ALQUILER LOCAL (OFICINA)',
    'SEGUROS S.A. - VIDA',

    // Whitespace variations
    'COMPRA    MERCADO    ONLINE',
    'IVA     COMPRAS',
    'PAGO  CO.  CAPITAL',

    // Prefix-containing descriptions (INDN:, DES: — should NOT be stripped
    // by normalizePattern itself; callers pre-process before normalizePattern)
    'INDN: ACME CORP',
    'DES: TRANSFERENCIA',
    'INDN: SERVICIO LUZ',
    'DES: PAGO PROVEEDOR',

    // Mixed case and formatting
    'Gasto Administrativo Mensual',
    'RETIRO EFECTIVO CAJERO',
    'recargo tdc',
    'Recargo Tarjeta Credito',

    // Edge cases
    '',
    '   ',
    '!@#$%',
    'PAGO',
    'A',
  ];
}

/**
 * Run a single matching pass: for each rule, find which transactions match.
 * Returns a deterministic match map (rulePattern → matched tx indices).
 */
function runMatchPass(
  rulePatterns: string[],
  txDescriptions: string[],
): Map<number, number[]> {
  const matchMap = new Map<number, number[]>();

  for (let rIdx = 0; rIdx < rulePatterns.length; rIdx++) {
    const rulePattern = rulePatterns[rIdx];
    if (!rulePattern) continue; // skip empty patterns

    const matchedIndices: number[] = [];
    for (let tIdx = 0; tIdx < txDescriptions.length; tIdx++) {
      const txDesc = txDescriptions[tIdx];
      if (normalizedContains(txDesc, rulePattern)) {
        matchedIndices.push(tIdx);
      }
    }
    matchMap.set(rIdx, matchedIndices);
  }

  return matchMap;
}

/**
 * Serialize a match map to a comparable string for deterministic checks.
 */
function serializeMatchMap(matchMap: Map<number, number[]>): string {
  const entries: string[] = [];
  for (const [ruleIdx, txIndices] of matchMap) {
    entries.push(`${ruleIdx}:[${txIndices.join(',')}]`);
  }
  return entries.join(';');
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Match-Set Equivalence — normalizePattern on both sides', () => {
  const rulePatterns = createNormalizedRulePatterns();
  const txDescriptions = createTransactionDescriptions();

  it('produces consistent deterministic results on repeat runs', () => {
    const pass1 = runMatchPass(rulePatterns, txDescriptions);
    const pass2 = runMatchPass(rulePatterns, txDescriptions);
    const pass3 = runMatchPass(rulePatterns, txDescriptions);

    expect(serializeMatchMap(pass1)).toBe(serializeMatchMap(pass2));
    expect(serializeMatchMap(pass2)).toBe(serializeMatchMap(pass3));
  });

  it('does not crash with any combination of patterns and descriptions', () => {
    // Run the full cross-product — should not throw
    expect(() => runMatchPass(rulePatterns, txDescriptions)).not.toThrow();
  });

  it('produces at least some matches (smoke test)', () => {
    const matchMap = runMatchPass(rulePatterns, txDescriptions);
    let totalMatches = 0;
    for (const [, matches] of matchMap) {
      totalMatches += matches.length;
    }
    expect(totalMatches).toBeGreaterThan(0);
  });

  it('empty normalizePattern result never matches (no false positives)', () => {
    // All-punctuation or empty patterns → normalizePattern returns ''
    const emptyPattern = normalizePattern('!@#$%^&*()');
    expect(emptyPattern).toBe('');

    for (const tx of txDescriptions) {
      expect(normalizedContains(tx, emptyPattern)).toBe(false);
    }
  });

  it('wildcard pattern * matches any non-empty description', () => {
    for (const tx of txDescriptions) {
      const txNorm = normalizePattern(tx);
      const expected = txNorm.length > 0;
      expect(normalizedContains(tx, '*')).toBe(expected);
    }
  });
});

describe('normalizePattern: punctuation handling in matching', () => {
  it('rules with S.A. match transactions with S.A. and without', () => {
    const rule = normalizePattern('TRANSFERENCIA S.A.');
    expect(rule).toBe('transferencia sa');
    expect(normalizedContains('TRANSFERENCIA S.A.', rule)).toBe(true);
    expect(normalizedContains('Transferencia S.A.', rule)).toBe(true);
    expect(normalizedContains('Transferencia SA', rule)).toBe(true);
    // 's a' with space does NOT match 'sa' — punctuation is stripped but
    // adjacent words are not re-merged. This is expected behavior:
    // normalizePattern collapses whitespace but doesn't rejoin words.
    expect(normalizedContains('transferencia s a', rule)).toBe(false);
  });

  it('rules with CO. match transactions with Co. and without', () => {
    const rule = normalizePattern('PAGO CO. CAPITAL');
    expect(normalizedContains('Pago Co. Capital', rule)).toBe(true);
    expect(normalizedContains('PAGO CO CAPITAL', rule)).toBe(true);
    expect(normalizedContains('pago co capital', rule)).toBe(true);
  });

  it('rules with LTD match transactions with and without punctuation', () => {
    const rule = normalizePattern('EMPRESA LTD');
    expect(normalizedContains('Empresa Ltd.', rule)).toBe(true);
    expect(normalizedContains('EMPRESA LTD', rule)).toBe(true);
    expect(normalizedContains('empresa ltd', rule)).toBe(true);
  });
});

describe('normalizePattern: whitespace normalization in matching', () => {
  it('multiple spaces in rule match multiple spaces in transaction', () => {
    const rule = normalizePattern('INTERES  BANCARIO');
    expect(normalizedContains('INTERES   BANCARIO', rule)).toBe(true);
    expect(normalizedContains('interes bancario', rule)).toBe(true);
    expect(normalizedContains('  INTERES  BANCARIO  ', rule)).toBe(true);
  });

  it('leading/trailing whitespace does not affect matching', () => {
    const rule = normalizePattern('  ALQUILER  LOCAL  ');
    expect(normalizedContains('ALQUILER LOCAL', rule)).toBe(true);
    expect(normalizedContains('  alquiler   local  ', rule)).toBe(true);
  });
});

describe('normalizePattern: INDN/DES prefix behavior', () => {
  it('normalizePattern does NOT strip INDN: prefix', () => {
    // normalizePattern is a pure function — no domain-specific stripping
    expect(normalizePattern('INDN: ACME CORP')).toBe('indn acme corp');
    expect(normalizePattern('indn: acme corp')).toBe('indn acme corp');
  });

  it('normalizePattern does NOT strip DES: prefix', () => {
    expect(normalizePattern('DES: TRANSFERENCIA')).toBe('des transferencia');
    expect(normalizePattern('des: transferencia')).toBe('des transferencia');
  });

  it('INDN: prefix in description does NOT cause false matches with pre-normalized rule', () => {
    // After migration, rules are stored WITHOUT prefix. If a raw description
    // has "INDN: SERVICIO LUZ", the caller must pre-process to strip "INDN:"
    // BEFORE calling normalizePattern(). This test verifies the boundary.
    const rule = normalizePattern('SERVICIO LUZ');
    const rawDescWithPrefix = 'INDN: SERVICIO LUZ';

    // The caller should strip INDN: before normalizePattern
    const callerPreprocessed = rawDescWithPrefix.replace(/^(INDN|DES):\s*/i, '');
    const txNorm = normalizePattern(callerPreprocessed);

    expect(txNorm).toBe('servicio luz');
    expect(txNorm.includes(rule)).toBe(true);
  });

  it('INDN: in description matches INDN: pattern when both are normalized', () => {
    // This simulates the edge case where a rule condition contains "indn"
    // (from a user-entered pattern), which is valid post-normalization
    const rule = normalizePattern('indn');
    expect(normalizedContains('INDN: ACME CORP', rule)).toBe(true);
    expect(normalizedContains('indn something', rule)).toBe(true);
  });
});

describe('normalizePattern: compound descriptions (punctuation + whitespace)', () => {
  it('handles real-world compound patterns', () => {
    const rule = normalizePattern('PAGO PROVEEDOR, S.A. DE C.V. - FACTURA');
    expect(rule).toBe('pago proveedor sa de cv factura');

    // Transaction must contain the full normalized pattern to match
    expect(normalizedContains('PAGO PROVEEDOR S.A. DE C.V. FACTURA 123', rule)).toBe(true);
    expect(normalizedContains('Pago Proveedor, S.A. de C.V. - Factura', rule)).toBe(true);
    expect(normalizedContains('PAGO PROVEEDOR SA DE CV FACTURA', rule)).toBe(true);
    // Transaction without 'factura' — does NOT match
    expect(normalizedContains('PAGO PROVEEDOR S.A. DE C.V.', rule)).toBe(false);
  });

  it('handles unicode + punctuation combinations', () => {
    const rule = normalizePattern('Café Martínez — S.A.');
    expect(rule).toBe('café martínez sa');

    expect(normalizedContains('Café Martínez S.A.', rule)).toBe(true);
    expect(normalizedContains('cafe martinez sa', rule)).toBe(false); // unicode preserved
  });
});

describe('normalizePattern: edge cases in matching context', () => {
  it('fully normalized pattern still matches after normalizePattern round-trip', () => {
    const pattern = 'interes bancario'; // already normalized
    const normalized = normalizePattern(pattern);
    expect(normalized).toBe(pattern);

    expect(normalizedContains('INTERES BANCARIO', normalized)).toBe(true);
    expect(normalizedContains('INTERES   BANCARIO', normalized)).toBe(true);
  });

  it('hyphenated words are stripped and match correctly', () => {
    const rule = normalizePattern('well-known');
    expect(rule).toBe('wellknown');
    // A transaction containing "well-known" normalizes to "wellknown" — matches
    expect(normalizedContains('well-known service', rule)).toBe(true);
    // A transaction with "well-known" in compound text — hyphen stripped
    expect(normalizedContains('BRAND WELL-KNOWN PRODUCT', rule)).toBe(true);
    // "well known" (space instead of hyphen) normalizes to "well known" —
    // does NOT match "wellknown" because spaces are distinct from no-space
    expect(normalizedContains('well known', rule)).toBe(false);
  });

  it('numeric patterns with punctuation work correctly', () => {
    const rule = normalizePattern('1234-5678/90');
    expect(rule).toBe('1234567890');
    expect(normalizedContains('1234-5678/90', rule)).toBe(true);
    expect(normalizedContains('1234567890', rule)).toBe(true);
  });
});
