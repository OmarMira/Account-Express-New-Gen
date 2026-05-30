import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { saveLogo } from '@/lib/uploads/logo-service';

export async function GET(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const companies = await db.company.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ companies });
  } catch (error) {
    console.error('[ADMIN COMPANIES GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

interface AccountSeed {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  parentCode?: string;
}

const CHART_OF_ACCOUNTS: AccountSeed[] = [
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
  {
    code: '1040',
    name: 'Prepaid Expenses',
    type: 'asset',
    normalBalance: 'debit',
    parentCode: '1000',
  },
  { code: '1100', name: 'Fixed Assets', type: 'asset', normalBalance: 'debit', parentCode: '1000' },
  { code: '1110', name: 'Equipment', type: 'asset', normalBalance: 'debit', parentCode: '1100' },
  { code: '1120', name: 'Vehicles', type: 'asset', normalBalance: 'debit', parentCode: '1100' },
  {
    code: '1130',
    name: 'Accumulated Depreciation',
    type: 'asset',
    normalBalance: 'credit',
    parentCode: '1100',
  },
  { code: '1200', name: 'Other Assets', type: 'asset', normalBalance: 'debit', parentCode: '1000' },
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
  {
    code: '3030',
    name: 'Current Year Earnings',
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
  // COGS
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', normalBalance: 'debit' },
  { code: '5010', name: 'Purchases', type: 'expense', normalBalance: 'debit', parentCode: '5000' },
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
  // Operating Expenses
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
  // Other Expenses
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
  // Income Tax
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

async function seedChartOfAccounts(tx: any, companyId: string) {
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

export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') || '';
    let legalName = '';
    let taxId = '';
    let phone = '';
    let email = '';
    let streetLine1 = '';
    let streetLine2 = '';
    let city = '';
    let state = '';
    let zipCode = '';
    let logoFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      legalName = (formData.get('legalName') as string) || '';
      taxId = (formData.get('taxId') as string) || '';
      phone = (formData.get('phone') as string) || '';
      email = (formData.get('email') as string) || '';
      streetLine1 = (formData.get('streetLine1') as string) || '';
      streetLine2 = (formData.get('streetLine2') as string) || '';
      city = (formData.get('city') as string) || '';
      state = (formData.get('state') as string) || '';
      zipCode = (formData.get('zipCode') as string) || '';
      logoFile = formData.get('logo') as File | null;
    } else {
      const body = await request.json();
      legalName = body.legalName || '';
      taxId = body.taxId || '';
      phone = body.phone || '';
      email = body.email || '';
      streetLine1 = body.streetLine1 || '';
      streetLine2 = body.streetLine2 || '';
      city = body.city || '';
      state = body.state || '';
      zipCode = body.zipCode || '';
    }

    if (!legalName) {
      return NextResponse.json({ error: 'legalName is required' }, { status: 400 });
    }

    let logoPath: string | null = null;
    if (logoFile && logoFile.size > 0) {
      logoPath = await saveLogo(logoFile);
    }

    const companyAddress =
      [streetLine1, streetLine2, city, state, zipCode].filter(Boolean).join(', ') || null;

    const company = await db.$transaction(async (tx) => {
      // 1. Create company
      const newCompany = await tx.company.create({
        data: {
          legalName,
          taxId: taxId || null,
          address: companyAddress,
          phone: phone || null,
          email: email || null,
          streetLine1,
          streetLine2,
          city,
          state,
          zipCode,
          logo: logoPath,
          isActive: true,
        },
      });

      // 2. Create membership for the admin user
      await tx.companyMember.create({
        data: {
          userId,
          companyId: newCompany.id,
          role: 'company_admin',
        },
      });

      // 3. Seed GAAP accounts
      await seedChartOfAccounts(tx, newCompany.id);

      // 5. Create audit log
      await tx.auditLog.create({
        data: {
          companyId: newCompany.id,
          userId,
          action: 'create_company',
          entity: 'Company',
          entityId: newCompany.id,
          details: `Created company ${newCompany.legalName} and auto-seeded chart of accounts`,
        },
      });

      return newCompany;
    });

    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    console.error('[ADMIN COMPANY POST]', error);
    const errMsg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
