import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { legalName, taxId, address, phone, email, isActive } = body;

    const company = await db.company.update({
      where: { id },
      data: {
        legalName,
        taxId: taxId !== undefined ? taxId : undefined,
        address: address !== undefined ? address : undefined,
        phone: phone !== undefined ? phone : undefined,
        email: email !== undefined ? email : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
    });

    await db.auditLog.create({
      data: {
        companyId: company.id,
        userId,
        action: 'update_company',
        entity: 'Company',
        entityId: company.id,
        details: `Updated company ${company.legalName}`,
      },
    });

    return NextResponse.json({ company });
  } catch (error) {
    console.error('[ADMIN COMPANY PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    // Hard delete is safe since cascading is active, but we can also just toggle active
    const company = await db.company.findUnique({ where: { id } });
    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    await db.company.delete({ where: { id } });

    await db.auditLog.create({
      data: {
        userId,
        action: 'delete_company',
        entity: 'Company',
        entityId: id,
        details: `Permanently deleted company ${company.legalName}`,
      },
    });

    return NextResponse.json({ message: 'Company permanently deleted' });
  } catch (error) {
    console.error('[ADMIN COMPANY DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
