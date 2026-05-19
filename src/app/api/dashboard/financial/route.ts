import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { hasCompanyAccess } from '@/lib/auth';


export async function GET(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
    }

    const hasAccess = await hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get all active bank accounts for the company
    const bankAccounts = await db.bankAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, accountName: true, bankName: true, accountNo: true },
    });

    const bankAccountIds = bankAccounts.map((a) => a.id);

    // Get all bank transactions for those bank accounts
    const transactions = await db.bankTransaction.findMany({
      where: {
        statement: {
          bankAccountId: { in: bankAccountIds },
        },
      },
      include: {
        glAccount: {
          select: {
            code: true,
            name: true,
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Format transactions to match dashboard requirements
    const formattedTransactions = transactions.map((t) => ({
      id: t.id,
      fecha: t.date.toISOString().split('T')[0],
      descripcion: t.description,
      monto: Math.abs(t.amount),
      tipo: t.amount > 0 ? 'credito' : 'debito',
      cuenta_contable: t.glAccount ? `${t.glAccount.code} ${t.glAccount.name}` : '',
      conciliado: t.isReconciled,
    }));

    return NextResponse.json({
      transactions: formattedTransactions,
      bankAccounts,
    });
  } catch (error) {
    console.error('[FINANCIAL DASHBOARD API ERROR]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
