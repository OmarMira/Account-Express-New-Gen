import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

export async function GET(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
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

export async function POST(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { legalName, taxId, address, phone, email } = body;

    if (!legalName) {
      return NextResponse.json({ error: 'legalName is required' }, { status: 400 });
    }

    const company = await db.company.create({
      data: {
        legalName,
        taxId: taxId || null,
        address: address || null,
        phone: phone || null,
        email: email || null,
        isActive: true,
      },
    });

    await db.auditLog.create({
      data: {
        companyId: company.id,
        userId,
        action: 'create_company',
        entity: 'Company',
        entityId: company.id,
        details: `Created company ${company.legalName}`,
      },
    });

    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    console.error('[ADMIN COMPANY POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
