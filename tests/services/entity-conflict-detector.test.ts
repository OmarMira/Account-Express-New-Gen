import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    company: {
      findUnique: vi.fn(),
    },
    entityContext: {
      findMany: vi.fn(),
    },
  },
}));

// We mock loadConfig to return a stable config for extractComponents
vi.mock('@/lib/services/entity-detector', () => ({
  loadConfig: vi.fn(),
  extractComponents: vi.fn(),
  jaroWinkler: vi.fn(),
  normalizePattern: vi.fn(),
}));

vi.mock('@/lib/services/pattern-normalizer', () => ({
  normalizePattern: vi.fn((s: string) => s.toLowerCase()),
}));

// ─── Imports after mocks ──────────────────────────────────────────────

import { db } from '@/lib/db';
import { loadConfig, extractComponents } from '@/lib/services/entity-detector';
import {
  detectConflictSync,
  detectConflict,
} from '@/lib/services/entity-conflict-detector';
import type { ConflictResult } from '@/lib/services/entity-conflict-detector';

// ─── detectConflictSync tests (pure function) ─────────────────────────

describe('detectConflictSync()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({});
  });

  it('TC1: SOCIO + merchant conflict detected → conflict=true, both entities found', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = detectConflictSync(
      'AMERICAN EXPRESS DES:PMT ID:123 INDN:LAURA QUIJANO',
      ['laura quijano'],
      false,
    );

    expect(result.conflict).toBe(true);
    expect(result.hasMerchant).toBe(true);
    expect(result.hasSocioInIndn).toBe(true);
    expect(result.merchantName).toBe('AMERICAN EXPRESS');
    expect(result.socioIndnName).toBe('LAURA QUIJANO');
  });

  it('TC2: Only SOCIO exists → conflict=false, hasSocioInIndn=true', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: null,
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = detectConflictSync('Zelle payment INDN:LAURA QUIJANO', ['laura quijano'], false);

    expect(result.conflict).toBe(false);
    expect(result.hasMerchant).toBe(false);
    expect(result.hasSocioInIndn).toBe(true);
    expect(result.socioIndnName).toBe('LAURA QUIJANO');
    expect(result.merchantName).toBeNull();
  });

  it('TC3: Only merchant exists → conflict=false, hasMerchant=true', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'WAL-MART',
      transferName: null,
      indnName: null,
    });

    const result = detectConflictSync('Zelle payment to WAL-MART', ['laura quijano'], false);

    expect(result.conflict).toBe(false);
    expect(result.hasMerchant).toBe(true);
    expect(result.hasSocioInIndn).toBe(false);
    expect(result.merchantName).toBe('WAL-MART');
    expect(result.socioIndnName).toBeNull();
  });

  it('TC4: No match → conflict=false, both null', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: null,
      transferName: null,
      indnName: null,
    });

    const result = detectConflictSync('plain description', ['laura quijano'], false);

    expect(result.conflict).toBe(false);
    expect(result.hasMerchant).toBe(false);
    expect(result.hasSocioInIndn).toBe(false);
    expect(result.merchantName).toBeNull();
    expect(result.socioIndnName).toBeNull();
  });

  it('TC5: entityFirstMode=true → socioWins=true (entity wins)', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = detectConflictSync(
      'AMERICAN EXPRESS DES:PMT ID:123 INDN:LAURA QUIJANO',
      ['laura quijano'],
      true,
    );

    expect(result.conflict).toBe(true);
    expect(result.socioWins).toBe(true);
  });

  it('TC6: entityFirstMode=false → socioWins=false (merchant/rule wins)', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = detectConflictSync(
      'AMERICAN EXPRESS DES:PMT ID:123 INDN:LAURA QUIJANO',
      ['laura quijano'],
      false,
    );

    expect(result.conflict).toBe(true);
    expect(result.socioWins).toBe(false);
  });

  it('TC7: entityFirstMode not set → defaults to false, no error', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = detectConflictSync(
      'AMERICAN EXPRESS DES:PMT ID:123 INDN:LAURA QUIJANO',
      ['laura quijano'],
      undefined as unknown as boolean,
    );

    // undefined is coerced to boolean → false → merchant wins
    expect(result.conflict).toBe(true);
    expect(result.socioWins).toBe(false);
  });

  it('TC8: Same result as old detectEntityConflict() — merchant+SOCIO detection', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'KMF',
      transferName: null,
      indnName: 'OMAR MIRA',
    });
    // Old detectEntityConflict returned:
    // { hasMerchant: true, hasSocioInIndn: true, merchantName: 'KMF', socioIndnName: 'OMAR MIRA' }

    const result = detectConflictSync(
      'KMF DES:KMFUSA.com ID:9876543210 INDN:OMAR MIRA CO ID:1234',
      ['omar mira'],
      false,
    );

    expect(result.hasMerchant).toBe(true);
    expect(result.hasSocioInIndn).toBe(true);
    expect(result.merchantName).toBe('KMF');
    expect(result.socioIndnName).toBe('OMAR MIRA');
  });

  it('TC9: Same result as old hasSocioConflict() — boolean conflict check', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });
    // Old hasSocioConflict returned: true (boolean) when merchant+SOCIO exist

    const result = detectConflictSync(
      'AMERICAN EXPRESS DES:ACH PMT ID:123 INDN:LAURA QUIJANO CO ID:9876',
      ['laura quijano'],
      false,
    );

    // conflict === true = hasSocioConflict's return value
    expect(result.conflict).toBe(true);
  });

  it('TC10: Same result as old entityFirstCheck() — skip detection', () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });
    // Old entityFirstCheck(tx, patterns, true):
    //   skipSocioRules: true (when entityFirstMode=true AND conflict)
    // Old entityFirstCheck(tx, patterns, false):
    //   skipSocioRules: false (when entityFirstMode=false)

    // entityFirstMode=true → skipSocioRules=true → equivalent to socioWins=true
    const resultTrue = detectConflictSync(
      'AMERICAN EXPRESS DES:ACH PMT ID:123 INDN:LAURA QUIJANO CO ID:9876',
      ['laura quijano'],
      true,
    );
    expect(resultTrue.socioWins).toBe(true);

    // entityFirstMode=false → skipSocioRules=false → equivalent to socioWins=false
    const resultFalse = detectConflictSync(
      'AMERICAN EXPRESS DES:ACH PMT ID:123 INDN:LAURA QUIJANO CO ID:9876',
      ['laura quijano'],
      false,
    );
    expect(resultFalse.socioWins).toBe(false);
  });
});

// ─── detectConflict async tests (DB-loading version) ──────────────────

describe('detectConflict()', () => {
  const mockCompany = { entityFirstMode: false };
  const mockEntities = [
    { id: 'ent-1', pattern: 'laURA quiJAno', role: 'SOCIO', glAccountId: null },
    { id: 'ent-2', pattern: 'AMERICAN EXPRESS', role: 'PROVEEDOR', glAccountId: 'gl-1' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({});
    (db.company.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockCompany);
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntities);
  });

  it('loads from DB and detects merchant+SOCIO conflict', async () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = await detectConflict(
      'comp-1',
      'AMERICAN EXPRESS',
      'AMERICAN EXPRESS DES:ACH PMT ID:123 INDN:LAURA QUIJANO CO ID:9876',
    );

    expect(result.conflict).toBe(true);
    expect(result.socioEntity).toBeDefined();
    expect(result.socioEntity!.role).toBe('SOCIO');
    expect(result.merchantEntity).toBeDefined();
    expect(result.merchantEntity!.role).toBe('PROVEEDOR');
    expect(result.reason).toContain('rule-first');
  });

  it('returns non-conflict result when no entity matches', async () => {
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: null,
      transferName: null,
      indnName: null,
    });

    const result = await detectConflict('comp-1', 'UNKNOWN', 'plain description');

    expect(result.conflict).toBe(false);
    expect(result.socioEntity).toBeUndefined();
    expect(result.merchantEntity).toBeUndefined();
  });

  it('entityFirstMode=true: SOCIO wins', async () => {
    (db.company.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ entityFirstMode: true });
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = await detectConflict(
      'comp-1',
      'AMERICAN EXPRESS',
      'AMERICAN EXPRESS DES:ACH PMT ID:123 INDN:LAURA QUIJANO CO ID:9876',
    );

    expect(result.conflict).toBe(true);
    expect(result.reason).toContain('entityFirstMode');
    expect(result.socioEntity!.role).toBe('SOCIO');
  });

  it('entityFirstMode defaults to false when company has null', async () => {
    (db.company.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ entityFirstMode: null });
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: 'AMERICAN EXPRESS',
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = await detectConflict(
      'comp-1',
      'AMERICAN EXPRESS',
      'AMERICAN EXPRESS DES:ACH PMT ID:123 INDN:LAURA QUIJANO CO ID:9876',
    );

    expect(result.conflict).toBe(true);
    expect(result.reason).toContain('rule-first');
  });

  it('returns non-conflict when only SOCIO entities match', async () => {
    (db.entityContext.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'ent-1', pattern: 'laura quijano', role: 'SOCIO', glAccountId: null },
    ]);
    (extractComponents as ReturnType<typeof vi.fn>).mockReturnValue({
      merchant: null,
      transferName: null,
      indnName: 'LAURA QUIJANO',
    });

    const result = await detectConflict('comp-1', 'LAURA QUIJANO', 'INDN:LAURA QUIJANO');

    expect(result.conflict).toBe(false);
    expect(result.socioEntity).toBeDefined();
    expect(result.merchantEntity).toBeUndefined();
  });
});
