import { db } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/auth';
import { AuthError, ValidationError } from '@/lib/api-error';
import { LoginInput, RegisterInput } from '@/lib/validations/auth';
import { withTiming } from '@/lib/timing';

export class AuthService {
  static login = withTiming(async (input: LoginInput) => {
    const { email, password } = input;
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        passwordHash: true,
        companyMemberships: {
          where: { company: { isActive: true } },
          include: {
            company: {
              select: { id: true, legalName: true, taxId: true, isActive: true },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new AuthError('Correo electrónico o contraseña inválidos');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new AuthError('Correo electrónico o contraseña inválidos');
    }

    const companies = user.companyMemberships.map((m) => m.company);
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      companies,
    };
  }, 'AuthService.login');

  static register = withTiming(async (input: RegisterInput) => {
    const { email, password, firstName, lastName, companyName, taxId } = input;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw new ValidationError('Ya existe una cuenta con este correo electrónico');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user and company in a transaction
    const result = await db.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: 'company_admin',
        },
      });

      // Create company
      const company = await tx.company.create({
        data: {
          legalName: companyName.trim(),
          taxId: taxId?.trim() || null,
        },
      });

      // Create company membership
      await tx.companyMember.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: 'company_admin',
        },
      });

      // Seed chart of accounts
      await this.seedChartOfAccounts(tx, company.id);

      return { user, company };
    });

    return result;
  }, 'AuthService.register');

  private static async seedChartOfAccounts(tx: any, companyId: string) {
    const CHART_OF_ACCOUNTS = [
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
      {
        code: '1030',
        name: 'Inventory',
        type: 'asset',
        normalBalance: 'debit',
        parentCode: '1000',
      },
      {
        code: '1040',
        name: 'Prepaid Expenses',
        type: 'asset',
        normalBalance: 'debit',
        parentCode: '1000',
      },
      {
        code: '1100',
        name: 'Fixed Assets',
        type: 'asset',
        normalBalance: 'debit',
        parentCode: '1000',
      },
      {
        code: '1110',
        name: 'Equipment',
        type: 'asset',
        normalBalance: 'debit',
        parentCode: '1100',
      },
      { code: '1120', name: 'Vehicles', type: 'asset', normalBalance: 'debit', parentCode: '1100' },
      {
        code: '1130',
        name: 'Accumulated Depreciation',
        type: 'asset',
        normalBalance: 'credit',
        parentCode: '1100',
      },
      {
        code: '1200',
        name: 'Other Assets',
        type: 'asset',
        normalBalance: 'debit',
        parentCode: '1000',
      },
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
      {
        code: '2030',
        name: 'Accrued Expenses',
        type: 'liability',
        normalBalance: 'credit',
        parentCode: '2000',
      },
      {
        code: '2040',
        name: 'Loans Payable',
        type: 'liability',
        normalBalance: 'credit',
        parentCode: '2000',
      },
      {
        code: '2100',
        name: 'Tax Liabilities',
        type: 'liability',
        normalBalance: 'credit',
        parentCode: '2000',
      },
      {
        code: '2110',
        name: 'Sales Tax Payable',
        type: 'liability',
        normalBalance: 'credit',
        parentCode: '2100',
      },
      {
        code: '2120',
        name: 'Payroll Liabilities',
        type: 'liability',
        normalBalance: 'credit',
        parentCode: '2100',
      },
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
      {
        code: '3030',
        name: 'Current Year Earnings',
        type: 'equity',
        normalBalance: 'credit',
        parentCode: '3000',
      },
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
      {
        code: '4030',
        name: 'Other Revenue',
        type: 'revenue',
        normalBalance: 'credit',
        parentCode: '4000',
      },
      {
        code: '4040',
        name: 'Sales Discounts',
        type: 'revenue',
        normalBalance: 'debit',
        parentCode: '4000',
      },
      { code: '5000', name: 'Cost of Goods Sold', type: 'expense', normalBalance: 'debit' },
      {
        code: '5010',
        name: 'Purchases',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '5000',
      },
      {
        code: '5020',
        name: 'Cost of Labor',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '5000',
      },
      {
        code: '5030',
        name: 'Freight & Shipping',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '5000',
      },
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
        code: '6040',
        name: 'Payroll Taxes',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      {
        code: '6050',
        name: 'Insurance Expense',
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
      {
        code: '6070',
        name: 'Professional Fees',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      {
        code: '6080',
        name: 'Marketing Expense',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      {
        code: '6090',
        name: 'Travel Expense',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      {
        code: '6100',
        name: 'Maintenance & Repairs',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      {
        code: '6110',
        name: 'Telecommunications',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      {
        code: '6120',
        name: 'Depreciation Expense',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      {
        code: '6130',
        name: 'Bad Debt Expense',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '6000',
      },
      { code: '7000', name: 'Other Expenses', type: 'expense', normalBalance: 'debit' },
      {
        code: '7010',
        name: 'Interest Expense',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '7000',
      },
      {
        code: '7020',
        name: 'Tax Expense',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '7000',
      },
      {
        code: '7030',
        name: 'Miscellaneous Expense',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '7000',
      },
      { code: '8000', name: 'Income Tax', type: 'expense', normalBalance: 'debit' },
      {
        code: '8010',
        name: 'Federal Income Tax',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '8000',
      },
      {
        code: '8020',
        name: 'State Income Tax',
        type: 'expense',
        normalBalance: 'debit',
        parentCode: '8000',
      },
    ];

    const idMap = new Map<string, string>();
    for (const account of CHART_OF_ACCOUNTS) {
      const created = await tx.glAccount.create({
        data: {
          companyId,
          code: account.code,
          name: account.name,
          accountType: account.type,
          normalBalance: account.normalBalance,
          parentId: account.parentCode ? idMap.get(account.parentCode) : null,
          isSystem: true,
          isActive: true,
        },
      });
      idMap.set(account.code, created.id);
    }
  }
}
