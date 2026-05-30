import { db } from '@/lib/db';
import { getPeriodStrategy } from '@/lib/fiscal-period/strategies';
import * as fs from 'fs';
import * as path from 'path';

const CHART_OF_ACCOUNTS = [
  // Assets
  { code: '1000', name: 'Assets', type: 'asset', normalBalance: 'debit' },
  {
    code: '1010',
    name: 'Cash & Cash Equivalents',
    type: 'asset',
    normalBalance: 'debit',
    parentCode: '1000',
  },
  {
    code: '1020',
    name: 'Accounts Receivable',
    type: 'asset',
    normalBalance: 'debit',
    parentCode: '1000',
  },
  { code: '1030', name: 'Inventory', type: 'asset', normalBalance: 'debit', parentCode: '1000' },
  { code: '1100', name: 'Fixed Assets', type: 'asset', normalBalance: 'debit', parentCode: '1000' },
  { code: '1110', name: 'Equipment', type: 'asset', normalBalance: 'debit', parentCode: '1100' },

  // Liabilities
  { code: '2000', name: 'Liabilities', type: 'liability', normalBalance: 'credit' },
  {
    code: '2010',
    name: 'Accounts Payable',
    type: 'liability',
    normalBalance: 'credit',
    parentCode: '2000',
  },
  {
    code: '2020',
    name: 'Credit Cards Payable',
    type: 'liability',
    normalBalance: 'credit',
    parentCode: '2000',
  },

  // Equity
  { code: '3000', name: 'Equity', type: 'equity', normalBalance: 'credit' },
  {
    code: '3010',
    name: "Owner's Equity",
    type: 'equity',
    normalBalance: 'credit',
    parentCode: '3000',
  },
  {
    code: '3020',
    name: 'Retained Earnings',
    type: 'equity',
    normalBalance: 'credit',
    parentCode: '3000',
  },

  // Revenue
  { code: '4000', name: 'Revenue', type: 'revenue', normalBalance: 'credit' },
  {
    code: '4010',
    name: 'Sales Revenue',
    type: 'revenue',
    normalBalance: 'credit',
    parentCode: '4000',
  },
  {
    code: '4020',
    name: 'Service Revenue',
    type: 'revenue',
    normalBalance: 'credit',
    parentCode: '4000',
  },

  // Expenses
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', normalBalance: 'debit' },
  { code: '6000', name: 'Operating Expenses', type: 'expense', normalBalance: 'debit' },
  {
    code: '6010',
    name: 'Rent Expense',
    type: 'expense',
    normalBalance: 'debit',
    parentCode: '6000',
  },
  {
    code: '6020',
    name: 'Utilities Expense',
    type: 'expense',
    normalBalance: 'debit',
    parentCode: '6000',
  },
  {
    code: '6030',
    name: 'Salaries & Wages',
    type: 'expense',
    normalBalance: 'debit',
    parentCode: '6000',
  },
  {
    code: '6060',
    name: 'Office Supplies',
    type: 'expense',
    normalBalance: 'debit',
    parentCode: '6000',
  },
  { code: '7000', name: 'Other Expenses', type: 'expense', normalBalance: 'debit' },
  {
    code: '7030',
    name: 'Miscellaneous Expense',
    type: 'expense',
    normalBalance: 'debit',
    parentCode: '7000',
  },
];

// Helper seguro para guardar configs en JSON sin modificar el schema de Prisma
function saveCompanyConfig(companyId: string, currency: string, periodType: string) {
  const rulesDir = path.join(process.cwd(), 'rules');
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }
  const configPath = path.join(rulesDir, 'company-config.json');
  let configData: any = { companies: {} };
  try {
    if (fs.existsSync(configPath)) {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('[ONBOARDING] Error reading company-config.json, creating new', err);
  }
  if (!configData.companies) {
    configData.companies = {};
  }
  configData.companies[companyId] = {
    currency,
    periodType,
    taxModuleEnabled: false,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
}

export async function completeOnboarding(
  companyId: string,
  legalName: string,
  currency: string,
  fiscalYearStartMonth: number,
  fiscalYearStartYear: number,
  periodType: 'CALENDAR' | 'CUSTOM_MONTHS' | 'WEEK_52_53',
  initialCashBalance?: number,
  userId?: string,
) {
  return await db.$transaction(async (tx) => {
    // 1. Validar que la compañía exista
    const company = await tx.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      throw new Error(`La compañía con ID ${companyId} no existe.`);
    }

    console.log(`[ONBOARDING] Initializing onboarding for: ${legalName}`);

    // Actualizar nombre legal
    await tx.company.update({
      where: { id: companyId },
      data: { legalName },
    });

    // Guardar moneda y tipo de periodo en config JSON inmutable
    saveCompanyConfig(companyId, currency, periodType);

    // 2. Generar Períodos Fiscales con el Patrón Strategy
    const strategy = getPeriodStrategy(periodType);
    const calculatedPeriods = strategy.calculate({
      year: fiscalYearStartYear,
      config: {
        type: periodType,
        startMonth: fiscalYearStartMonth,
        closingAccountCode: '3020',
        periodsPerYear: 12,
        allowShortPeriods: false,
      },
    });

    // Guardar los períodos calculados de manera transaccional
    for (const period of calculatedPeriods) {
      const existingPeriod = await tx.fiscalPeriod.findUnique({
        where: {
          companyId_name: {
            companyId,
            name: period.name,
          },
        },
      });

      if (!existingPeriod) {
        await tx.fiscalPeriod.create({
          data: {
            companyId,
            name: period.name,
            startDate: period.startDate,
            endDate: period.endDate,
            isLocked: false,
          },
        });
      }
    }
    console.log(
      `[ONBOARDING] Generated ${calculatedPeriods.length} periods via ${periodType} strategy`,
    );

    // 3. Crear Plan de Cuentas GAAP (COA) - Obligatorio antes del asiento de apertura (FK Constraint Guardrail 1)
    const existingAccountsCount = await tx.glAccount.count({
      where: { companyId },
    });

    const accountIdMap = new Map<string, string>();

    if (existingAccountsCount === 0) {
      console.log(`[ONBOARDING] Seeding GAAP chart of accounts...`);
      for (const account of CHART_OF_ACCOUNTS) {
        const created = await tx.glAccount.create({
          data: {
            companyId,
            code: account.code,
            name: account.name,
            accountType: account.type,
            normalBalance: account.normalBalance,
            parentId: account.parentCode ? accountIdMap.get(account.parentCode) : null,
            isSystem: true,
            isActive: true,
          },
        });
        accountIdMap.set(account.code, created.id);
      }
      console.log(`[ONBOARDING] Created ${CHART_OF_ACCOUNTS.length} standard accounts`);
    } else {
      const accounts = await tx.glAccount.findMany({
        where: { companyId },
      });
      for (const a of accounts) {
        accountIdMap.set(a.code, a.id);
      }
    }

    // 4. Asiento de Apertura de Saldos Iniciales (Solo si initialCashBalance > 0)
    let journalEntryId: string | undefined;
    if (initialCashBalance && initialCashBalance > 0) {
      const cashAccountId = accountIdMap.get('1010');
      const equityAccountId = accountIdMap.get('3010');

      if (!cashAccountId || !equityAccountId) {
        throw new Error(
          'Cuentas GL Cash (1010) o Equity (3010) no encontradas en el seeder contable.',
        );
      }

      // Crear asiento balanceado (Débito a Cash, Crédito a Equity)
      const openingEntry = await tx.journalEntry.create({
        data: {
          companyId,
          date: calculatedPeriods[0].startDate,
          description: 'Asiento de apertura - Saldo de efectivo inicial configurado en Onboarding',
          reference: 'OPENING-BALANCE',
          status: 'posted',
          lines: {
            create: [
              {
                glAccountId: cashAccountId,
                description: 'Efectivo y equivalentes de efectivo iniciales',
                debit: initialCashBalance,
                credit: 0,
              },
              {
                glAccountId: equityAccountId,
                description: 'Aportación de capital - Saldos iniciales',
                debit: 0,
                credit: initialCashBalance,
              },
            ],
          },
        },
      });
      journalEntryId = openingEntry.id;
      console.log(`[ONBOARDING] Opening Journal Entry posted successfully: $${initialCashBalance}`);

      // Crear BankAccount por defecto vinculada al efectivo
      await tx.bankAccount.create({
        data: {
          companyId,
          accountName: 'Efectivo Operativo (Caja General)',
          bankName: 'Caja General Onboarding',
          accountNo: 'CASH-OPERATIVE',
          glAccountId: cashAccountId,
          balance: initialCashBalance,
          initialBalance: initialCashBalance,
          currency,
          isActive: true,
        },
      });
    }

    // 5. Marcar onboarding como completado
    const updatedCompany = await tx.company.update({
      where: { id: companyId },
      data: { isOnboardingComplete: true },
    });

    // 6. Traza Forense en AuditLog (Guardrail 3)
    await tx.auditLog.create({
      data: {
        companyId,
        userId: userId || null,
        action: 'ONBOARDING_COMPLETED',
        entity: 'Company',
        entityId: companyId,
        details: JSON.stringify({
          payload: {
            companyId,
            legalName,
            currency,
            fiscalYearStartMonth,
            fiscalYearStartYear,
            periodType,
            initialCashBalance: initialCashBalance || 0,
          },
          strategyUsed: periodType,
          periodsGenerated: calculatedPeriods.length,
          openingBalanceApplied: initialCashBalance && initialCashBalance > 0 ? true : false,
          journalEntryId: journalEntryId || null,
        }),
      },
    });

    console.log(
      `[ONBOARDING] Complete system activation succeeded for: ${updatedCompany.legalName}`,
    );

    return {
      success: true,
      company: updatedCompany,
    };
  });
}
