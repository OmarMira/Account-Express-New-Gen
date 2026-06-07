import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localHeuristicParse, parseConversationalContext } from '@/lib/services/conversational-service';

vi.mock('@/lib/db', () => ({
  db: { glAccount: { findFirst: vi.fn() } },
}));

vi.mock('@/lib/services/audit-service', () => ({
  safeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { db } from '@/lib/db';

describe('ConversationalService Heuristics', () => {
  it('debe priorizar el rol SOCIO sobre el tipo GASTO según la prioridad configurada', () => {
    // GIVEN a classification request with userInput: "socio retiro gasto capital"
    // WHEN localHeuristicParse is called
    // THEN it MUST return role "SOCIO" and account "3010" because SOCIO has higher priority than GASTO_OPERATIVO/GASTO
    const result = localHeuristicParse('socio retiro gasto capital');
    expect(result.role).toBe('SOCIO');
    expect(result.glAccountCode).toBe('3010');
  });

  it('debe caer en el rol fallback por defecto si nada coincide', () => {
    // GIVEN a classification request with userInput: "unknown descriptor"
    // WHEN no keywords match any configuration rules
    // THEN it MUST fallback to the default role "PROVEEDOR" and account "6070"
    const result = localHeuristicParse('unknown descriptor');
    expect(result.role).toBe('PROVEEDOR');
    expect(result.glAccountCode).toBe('6070');
  });

  it('debe priorizar EMPLEADO sobre GASTO_OPERATIVO si la prioridad está definida', () => {
    const result = localHeuristicParse('gasto de salario del empleado');
    expect(result.role).toBe('EMPLEADO');
    expect(result.glAccountCode).toBe('6030');
  });
});

describe('parseConversationalContext DB resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure AI env vars are unset so we test the fallback → DB path
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
  });

  it('debe resolver el nombre de la cuenta desde la BD cuando existe el código', async () => {
    // Mock DB to return an account for code '4000' only
    const accounts: Record<string, any> = {
      '4000': { id: 'gl-4000', code: '4000', name: 'Revenue', companyId: 'company-1', isActive: true },
    };
    (db.glAccount.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: any) => Promise.resolve(accounts[where.code] ?? null),
    );

    const result = await parseConversationalContext(
      'company-1',
      'gasto de materiales',
      'compra de materiales para oficina',
    );

    // The heuristic fallback classifies "gasto" as GASTO_OPERATIVO with code '5000'.
    expect(db.glAccount.findFirst).toHaveBeenCalled();
    expect(result.role).toBe('GASTO_OPERATIVO');
    expect(result.glAccountCode).toBe('5000');
    // Code '5000' is not in our mock map → DB returns null → id null, name default
    expect(result.glAccountId).toBeNull();
    expect(result.account.name).toBe('Cuenta No Clasificada');
  });

  it('debe usar el nombre de la BD cuando el código existe en la BD', async () => {
    // Mock DB to return an account for code '5000'
    const accounts: Record<string, any> = {
      '5000': { id: 'gl-5000', code: '5000', name: 'Cost of Goods Sold', companyId: 'company-1', isActive: true },
    };
    (db.glAccount.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }: any) => Promise.resolve(accounts[where.code] ?? null),
    );

    const result = await parseConversationalContext(
      'company-1',
      'gasto de oficina',
      'compra de suministros',
    );

    // Heuristic returns GASTO_OPERATIVO with code '5000'
    expect(result.glAccountCode).toBe('5000');
    // DB found the account → name and id come from DB
    expect(result.glAccountId).toBe('gl-5000');
    expect(result.account.name).toBe('Cost of Goods Sold');
  });
});
