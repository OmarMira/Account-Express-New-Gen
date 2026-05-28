import { db } from '@/lib/db';

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

export async function completeOnboarding(
  companyId: string,
  fiscalYearStartMonth: number, // 1 to 12
  fiscalYearStartYear: number = 2025, // Nuevo parámetro dinámico para cargar periodos anteriores
) {
  return await db.$transaction(async (tx) => {
    // 1. Validar que la compañía exista
    const company = await tx.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      throw new Error(`La compañía con ID ${companyId} no existe.`);
    }

    console.log(`[ONBOARDING] Initializing onboarding for company: ${company.legalName}`);

    // 2. Crear los FiscalPeriods para el año dinámico
    // Calculamos el inicio del año fiscal basándonos en el mes especificado
    const startYear = fiscalYearStartYear;
    const startDate = new Date(Date.UTC(startYear, fiscalYearStartMonth - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(startYear + 1, fiscalYearStartMonth - 1, 0, 23, 59, 59, 999));

    // Validar si ya existe el periodo fiscal para evitar duplicados
    const periodName = `FY ${startYear}`;
    const existingPeriod = await tx.fiscalPeriod.findUnique({
      where: {
        companyId_name: {
          companyId,
          name: periodName,
        },
      },
    });

    if (!existingPeriod) {
      await tx.fiscalPeriod.create({
        data: {
          companyId,
          name: periodName,
          startDate,
          endDate,
          isLocked: false,
        },
      });
      console.log(`[ONBOARDING] Created FiscalPeriod: ${periodName}`);
    }

    // 3. Crear Plan de Cuentas (Chart of Accounts)
    const existingAccountsCount = await tx.glAccount.count({
      where: { companyId },
    });

    const accountIdMap = new Map<string, string>();

    if (existingAccountsCount === 0) {
      console.log(`[ONBOARDING] Seeding standard chart of accounts...`);
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
      // Si ya existen, mapeamos los códigos existentes
      const accounts = await tx.glAccount.findMany({
        where: { companyId },
      });
      for (const a of accounts) {
        accountIdMap.set(a.code, a.id);
      }
    }

    // 4. Marcar la compañía como configurada
    const updatedCompany = await tx.company.update({
      where: { id: companyId },
      data: { isOnboardingComplete: true },
    });

    console.log(`[ONBOARDING] Onboarding completed for company: ${updatedCompany.legalName}`);

    return {
      success: true,
      company: updatedCompany,
    };
  });
}
