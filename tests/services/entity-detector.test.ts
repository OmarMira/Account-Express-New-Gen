import { describe, it, expect } from 'vitest';
import { clusterCandidates, loadConfig } from '@/lib/services/entity-detector';

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
