import { describe, it, expect } from 'vitest';
import { clusterCandidates, extractName, loadConfig } from '@/lib/services/entity-detector';

describe('Entity Extraction & Clustering', () => {
  it('debe extraer y agrupar más de 3 entidades sin truncar o limitar a 3', () => {
    const transactions = [
      { description: 'Zelle from 7-ELEVEN', amount: 50.0, date: '2026-05-25' },
      { description: 'Zelle from 7-ELEVEN', amount: 50.0, date: '2026-05-25' },
      { description: 'Zelle from WAL-MART', amount: 100.0, date: '2026-05-25' },
      { description: 'Zelle from WAL-MART', amount: 100.0, date: '2026-05-25' },
      { description: 'Zelle from O\'REILLY', amount: 150.0, date: '2026-05-25' },
      { description: 'Zelle from O\'REILLY', amount: 150.0, date: '2026-05-25' },
      { description: 'Zelle from STARBUCKS', amount: 10.0, date: '2026-05-25' },
      { description: 'Zelle from STARBUCKS', amount: 10.0, date: '2026-05-25' },
      { description: 'Zelle from MCDONALDS', amount: 20.0, date: '2026-05-25' },
      { description: 'Zelle from MCDONALDS', amount: 20.0, date: '2026-05-25' },
    ];

    const config = loadConfig();
    const result = clusterCandidates(transactions, config);

    expect(result.length).toBeGreaterThan(3);
  });

  it('debe capturar correctamente nombres con dígitos, guiones y apóstrofes (7-ELEVEN, WAL-MART, O\'REILLY)', () => {
    const transactions = [
      { description: 'Zelle from 7-ELEVEN', amount: 50.0, date: '2026-05-25' },
      { description: 'Zelle from 7-ELEVEN', amount: 50.0, date: '2026-05-25' },
      { description: 'Zelle from WAL-MART', amount: 100.0, date: '2026-05-25' },
      { description: 'Zelle from WAL-MART', amount: 100.0, date: '2026-05-25' },
      { description: 'Zelle from O\'REILLY', amount: 150.0, date: '2026-05-25' },
      { description: 'Zelle from O\'REILLY', amount: 150.0, date: '2026-05-25' },
    ];

    const config = loadConfig();
    const result = clusterCandidates(transactions, config);

    const names = result.map(c => c.canonicalName.toUpperCase());
    expect(names).toContain('7-ELEVEN');
    expect(names).toContain('WAL-MART');
    expect(names).toContain('O\'REILLY');
  });
});

// ─── Escenario 1: P1 gana sobre P3 (el bug original de Amex + INDN:LAURA) ────
describe('extractName — Priority 1 (merchant) wins over Priority 3 (INDN ACH)', () => {
  it('debe retornar el merchant "AMERICAN EXPRESS" y NO "LAURA QUIJANO" cuando ambos están presentes', () => {
    // This is the exact bug: P3 (INDN:) was priority 1 before the fix,
    // causing "LAURA QUIJANO" to be extracted instead of "AMERICAN EXPRESS".
    const config = loadConfig();
    const raw = 'AMERICAN EXPRESS DES:ACH PMT ID:1234567890 INDN:LAURA QUIJANO CO ID:9876';
    const result = extractName(raw, config);

    expect(result).not.toBeNull();
    expect(result!.toUpperCase()).toContain('AMERICAN EXPRESS');
    expect(result!.toUpperCase()).not.toContain('LAURA QUIJANO');
  });

  it('debe retornar el merchant "KMF" y NO el nombre del socio cuando ambos están presentes', () => {
    const config = loadConfig();
    const raw = 'KMF DES:KMFUSA.com ID:9876543210 INDN:OMAR MIRA CO ID:1234';
    const result = extractName(raw, config);

    expect(result).not.toBeNull();
    expect(result!.toUpperCase()).toContain('KMF');
    expect(result!.toUpperCase()).not.toContain('OMAR MIRA');
  });
});

// ─── Escenario 2: P2 captura el nombre en Zelle directo (no confunde con merchant) ──
describe('extractName — Priority 2 (Zelle/transfer) captures person name correctly', () => {
  it('debe extraer "LAURA QUIJANO" de un Zelle payment to cuando no hay merchant al inicio', () => {
    // After sanitization "Zelle payment" prefix is stripped → "to LAURA QUIJANO" remains.
    // P1 won't match (no DES:/ID: descriptor), P2 matches "to LAURA QUIJANO".
    const config = loadConfig();
    const raw = 'Zelle payment to LAURA QUIJANO';
    const result = extractName(raw, config);

    expect(result).not.toBeNull();
    expect(result!.toUpperCase()).toContain('LAURA QUIJANO');
  });

  it('debe extraer "OMAR MIRA" de un Zelle to OMAR MIRA', () => {
    const config = loadConfig();
    const raw = 'Zelle to OMAR MIRA';
    const result = extractName(raw, config);

    expect(result).not.toBeNull();
    expect(result!.toUpperCase()).toContain('OMAR MIRA');
  });
});

// ─── Escenario 3: P3 solo actúa como fallback para ACH puro sin merchant ni keyword ──
describe('extractName — Priority 3 (INDN ACH) only fires as fallback', () => {
  it('debe extraer el nombre de INDN: cuando no hay merchant posicional ni keyword de transferencia', () => {
    // Pure ACH transaction with no merchant at start and no "from/to/payee" keyword.
    const config = loadConfig();
    const raw = 'ACH CREDIT INDN:JOHN SMITH CO ID:98765 CCD';
    const result = extractName(raw, config);

    expect(result).not.toBeNull();
    expect(result!.toUpperCase()).toContain('JOHN SMITH');
  });

  it('NO debe extraer INDN: si P1 ya capturó un merchant', () => {
    // If P1 fires, P3 must NOT be reached.
    const config = loadConfig();
    const raw = 'TOYOTA MOTOR DES:PAYMENT ID:555 INDN:OMAR MIRA CO ID:123 CCD';
    const result = extractName(raw, config);

    expect(result).not.toBeNull();
    expect(result!.toUpperCase()).not.toContain('OMAR MIRA');
  });
});
