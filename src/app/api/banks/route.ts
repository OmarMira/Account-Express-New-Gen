import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { verifyCompanyAccess } from '@/lib/verify-access';
import { computeAuditHash } from '@/lib/journal-hash';

// ─── GET /api/banks?companyId=xxx ──────────────────────────────────────
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('companyId');

  if (!companyId) {
    return NextResponse.json(
      { error: 'companyId is required' },
      { status: 400 }
    );
  }

  // Verify access
  const access = await verifyCompanyAccess(userId, companyId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  try {
    const accounts = await db.bankAccount.findMany({
      where: { companyId },
      include: {
        glAccount: {
          select: { id: true, code: true, name: true, accountType: true },
        },
        _count: {
          select: { statements: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('[BANKS LIST ERROR]', error);
    return NextResponse.json(
      { error: 'Failed to fetch bank accounts' },
      { status: 500 }
    );
  }
}

// ─── POST /api/banks ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      companyId,
      accountName,
      bankName,
      accountNo,
      routingNo,
      glAccountId,
      balance,
      currency,
    } = body;

    // Validate required fields
    if (!companyId || !accountName || !bankName || !glAccountId) {
      return NextResponse.json(
        {
          error:
            'companyId, accountName, bankName, and glAccountId are required',
        },
        { status: 400 }
      );
    }

    // Verify admin access
    const access = await verifyCompanyAccess(userId, companyId, 'admin');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Validate GL account exists, belongs to company, and is asset type
    const glAccount = await db.glAccount.findFirst({
      where: { id: glAccountId, companyId, isActive: true },
    });
    if (!glAccount) {
      return NextResponse.json(
        { error: 'GL account not found or inactive' },
        { status: 404 }
      );
    }
    if (glAccount.accountType !== 'asset') {
      return NextResponse.json(
        {
          error:
            'Bank accounts must be linked to an asset-type GL account',
        },
        { status: 400 }
      );
    }

    const account = await db.bankAccount.create({
      data: {
        companyId,
        accountName: accountName.trim(),
        bankName: bankName.trim(),
        accountNo: accountNo?.trim() || null,
        routingNo: routingNo?.trim() || null,
        glAccountId,
        balance: parseFloat(balance) || 0,
        currency: currency || 'USD',
        isActive: true,
      },
      include: {
        glAccount: {
          select: { id: true, code: true, name: true, accountType: true },
        },
      },
    });

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ bankAccountId: account.id, accountName: account.accountName, bankName: account.bankName, glAccountId });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId, userId, action: 'create_bank_account', entity: 'BankAccount',
        entityId: account.id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId, userId, action: 'create_bank_account', entity: 'BankAccount',
      entityId: account.id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    console.error('[BANKS CREATE ERROR]', error);
    return NextResponse.json(
      { error: 'Failed to create bank account' },
      { status: 500 }
    );
  }
}
