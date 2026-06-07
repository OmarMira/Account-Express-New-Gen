import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSemanticDirection } from '@/lib/semantic-validator';
import { ReconciliationService } from '@/services/reconciliation.service';
import { createTestCompany, createTestGlAccount, clearDatabase } from './helpers/factories';
import { db } from '@/lib/db';

describe('Accounting Semantic Validator', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterEach(async () => {
    await clearDatabase();
  });

  describe('validateSemanticDirection Unit Tests', () => {
    it('debe advertir (retornar warning) si cuenta Clase 3 (Patrimonio) se debita sin palabras clave de retiro/socio', () => {
      const warning = validateSemanticDirection('3010', 'debit', 'Pago de servicios de internet de la oficina');
      expect(warning).not.toBeNull();
      expect(warning).toContain('La cuenta de patrimonio (Clase 3) registra un débito');
    });

    it('debe permitir si cuenta Clase 3 se debita con palabras clave de retiro/socio', () => {
      const warning = validateSemanticDirection('3010', 'debit', 'Retiro de capital del socio Juan Pérez');
      expect(warning).toBeNull();
    });

    it('debe permitir créditos normales en cuenta Clase 3 sin warnings', () => {
      const warning = validateSemanticDirection('3010', 'credit', 'Aporte de capital inicial');
      expect(warning).toBeNull();
    });

    it('debe advertir si cuenta Clase 4 (Ingresos) se debita sin palabras clave de reembolso/devolución', () => {
      const warning = validateSemanticDirection('4010', 'debit', 'Pago ordinario de factura mensual');
      expect(warning).not.toBeNull();
      expect(warning).toContain('La cuenta de ingresos (Clase 4) registra un débito');
    });

    it('debe permitir si cuenta Clase 4 se debita con palabras clave de reembolso/devolución', () => {
      const warning = validateSemanticDirection('4010', 'debit', 'Reembolso por servicio no prestado');
      expect(warning).toBeNull();
    });

    it('debe permitir créditos normales en cuenta Clase 4 sin warnings', () => {
      const warning = validateSemanticDirection('4010', 'credit', 'Venta de mercaderías facturada');
      expect(warning).toBeNull();
    });

    it('debe advertir si cuenta Clase 5 (Gastos) se acredita sin palabras clave de reembolso/abono', () => {
      const warning = validateSemanticDirection('5010', 'credit', 'Compra de suministros varios');
      expect(warning).not.toBeNull();
      expect(warning).toContain('La cuenta de gastos o costos (Clase 5/6) registra un crédito');
    });

    it('debe permitir si cuenta Clase 5 se acredita con palabras clave de reembolso/abono', () => {
      const warning = validateSemanticDirection('5010', 'credit', 'Abono de nota de crédito por materiales defectuosos');
      expect(warning).toBeNull();
    });

    it('debe permitir débitos normales en cuenta Clase 5 sin warnings', () => {
      const warning = validateSemanticDirection('5010', 'debit', 'Pago de alquiler de oficina');
      expect(warning).toBeNull();
    });
  });

  describe('ReconciliationService Integration', () => {
    it('debe conciliar exitosamente pero retornar advertencias semánticas en el resultado', async () => {
      const company = await createTestCompany();
      const bankAccount = await db.bankAccount.create({
        data: {
          companyId: company.id,
          accountName: 'Bank Account Test',
          bankName: 'BoA',
          accountNo: '1234',
          balance: 1000,
          currency: 'USD',
          glAccountId: (await createTestGlAccount({ companyId: company.id, code: '1010', name: 'Cash' })).id,
        },
      });

      const statement = await db.bankStatement.create({
        data: {
          companyId: company.id,
          bankAccountId: bankAccount.id,
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: new Date('2026-06-30T23:59:59.999Z'),
          openingBalance: 1000,
          closingBalance: 900,
          format: 'pdf',
        },
      });

      // Pago de banco (amount < 0) => movimiento debit para el destino
      const bankTx = await db.bankTransaction.create({
        data: {
          statementId: statement.id,
          date: new Date('2026-06-15T12:00:00.000Z'),
          description: 'Compra de muebles de oficina',
          amount: -100, // Pago
          isReconciled: false,
        },
      });

      // Cuenta destino Clase 3 (Patrimonio) - debitar patrimonio sin keywords asociadas a retiro/socio debe advertir
      const glAccount = await createTestGlAccount({ companyId: company.id, code: '3010', name: 'Capital' });

      // Configurar período activo
      await db.fiscalPeriod.create({
        data: {
          companyId: company.id,
          name: 'June 2026',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: new Date('2026-06-30T23:59:59.999Z'),
          isLocked: false,
        },
      });

      const result = await ReconciliationService.reconcile({
        companyId: company.id,
        bankAccountId: bankAccount.id,
        createJournalEntries: true,
        transactions: [
          {
            id: bankTx.id,
            glAccountId: glAccount.id,
          },
        ],
      });

      expect(result.reconciledCount).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('La cuenta de patrimonio (Clase 3) registra un débito');
    });
  });
});
