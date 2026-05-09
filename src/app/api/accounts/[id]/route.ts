import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { verifyCompanyAccess } from '@/lib/verify-access';
import { computeAuditHash } from '@/lib/journal-hash';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ─── GET /api/accounts/[id] ────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const userId = await getSessionUserId(_request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const account = await db.glAccount.findUnique({
      where: { id },
      include: {
        parent: {
          select: { id: true, code: true, name: true },
        },
        children: {
          include: {
            parent: {
              select: { id: true, code: true, name: true },
            },
            _count: {
              select: { children: true, journalLines: true },
            },
          },
          orderBy: [{ code: 'asc' }],
        },
        _count: {
          select: { children: true, journalLines: true },
        },
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ account });
  } catch (error) {
    console.error('[ACCOUNT GET ERROR]', error);
    return NextResponse.json(
      { error: 'Failed to fetch account' },
      { status: 500 }
    );
  }
}

// ─── PUT /api/accounts/[id] ────────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, isActive, code, accountType, normalBalance, parentId } = body;

    // Check account exists
    const existing = await db.glAccount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Verify admin access
    const access = await verifyCompanyAccess(userId, existing.companyId, 'admin');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Build update data with only provided fields
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json(
          { error: 'Account name cannot be empty' },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    if (code !== undefined) {
      const trimmedCode = code.trim();
      if (!trimmedCode) {
        return NextResponse.json(
          { error: 'Account code cannot be empty' },
          { status: 400 }
        );
      }
      // Check uniqueness within company (excluding current account)
      const duplicate = await db.glAccount.findFirst({
        where: {
          companyId: existing.companyId,
          code: trimmedCode,
          id: { not: id },
        },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: 'An account with this code already exists in this company' },
          { status: 409 }
        );
      }
      updateData.code = trimmedCode;
    }

    if (accountType !== undefined) {
      const validTypes = ['asset', 'liability', 'equity', 'revenue', 'expense'];
      if (!validTypes.includes(accountType)) {
        return NextResponse.json(
          { error: `Invalid accountType. Must be one of: ${validTypes.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.accountType = accountType;
    }

    if (normalBalance !== undefined) {
      if (!['debit', 'credit'].includes(normalBalance)) {
        return NextResponse.json(
          { error: 'Invalid normalBalance. Must be debit or credit' },
          { status: 400 }
        );
      }
      updateData.normalBalance = normalBalance;
    }

    if (parentId !== undefined) {
      if (parentId === null) {
        updateData.parentId = null;
      } else {
        // Validate parent exists and belongs to same company
        const parentAccount = await db.glAccount.findFirst({
          where: { id: parentId, companyId: existing.companyId },
        });
        if (!parentAccount) {
          return NextResponse.json(
            { error: 'Parent account not found' },
            { status: 404 }
          );
        }
        // Prevent circular reference
        if (parentId === id) {
          return NextResponse.json(
            { error: 'An account cannot be its own parent' },
            { status: 400 }
          );
        }
        updateData.parentId = parentId;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const account = await db.glAccount.update({
      where: { id },
      data: updateData,
      include: {
        parent: {
          select: { id: true, code: true, name: true },
        },
        _count: {
          select: { children: true, journalLines: true },
        },
      },
    });

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ id, changes: updateData });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId: existing.companyId, userId, action: 'update_account', entity: 'GlAccount',
        entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId: existing.companyId, userId, action: 'update_account', entity: 'GlAccount',
      entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({ account });
  } catch (error) {
    console.error('[ACCOUNT UPDATE ERROR]', error);
    return NextResponse.json(
      { error: 'Failed to update account' },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/accounts/[id] (soft delete: set isActive=false) ───────
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const account = await db.glAccount.findUnique({
      where: { id },
      include: {
        _count: {
          select: { children: true, journalLines: true },
        },
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Verify admin access
    const access = await verifyCompanyAccess(userId, account.companyId, 'admin');
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 403 });
    }

    // Cannot delete system accounts
    if (account.isSystem) {
      return NextResponse.json(
        { error: 'System accounts cannot be deleted' },
        { status: 403 }
      );
    }

    // Cannot delete accounts with children
    if (account._count.children > 0) {
      return NextResponse.json(
        { error: 'This account has sub-accounts and cannot be deleted. Delete or reassign sub-accounts first.' },
        { status: 409 }
      );
    }

    // Cannot delete accounts with transactions
    if (account._count.journalLines > 0) {
      return NextResponse.json(
        { error: 'This account has journal entries and cannot be deleted' },
        { status: 409 }
      );
    }

    // Soft delete
    const updated = await db.glAccount.update({
      where: { id },
      data: { isActive: false },
      include: {
        parent: {
          select: { id: true, code: true, name: true },
        },
        _count: {
          select: { children: true, journalLines: true },
        },
      },
    });

    // Audit log with HMAC chain
    const lastAudit = await db.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const auditDetails = JSON.stringify({ id, code: account.code, name: account.name });
    const createdAudit = await db.auditLog.create({
      data: {
        companyId: account.companyId, userId, action: 'deactivate_account', entity: 'GlAccount',
        entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
      },
    });
    const auditHash = computeAuditHash({
      id: createdAudit.id, companyId: account.companyId, userId, action: 'deactivate_account', entity: 'GlAccount',
      entityId: id, details: auditDetails, previousHash: lastAudit?.hash ?? null,
    });
    await db.auditLog.update({ where: { id: createdAudit.id }, data: { hash: auditHash } });

    return NextResponse.json({ account: updated });
  } catch (error) {
    console.error('[ACCOUNT DELETE ERROR]', error);
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}
