import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { saveLogo, deleteLogo } from '@/lib/uploads/logo-service';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const contentType = request.headers.get('content-type') || '';
    let legalName,
      taxId,
      phone,
      email,
      isActive,
      streetLine1,
      streetLine2,
      city,
      state,
      zipCode,
      logoCleared,
      logoFile;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      legalName = formData.get('legalName') as string | null;
      taxId = formData.get('taxId') as string | null;
      phone = formData.get('phone') as string | null;
      email = formData.get('email') as string | null;
      isActive =
        formData.get('isActive') !== null ? formData.get('isActive') === 'true' : undefined;
      streetLine1 = formData.get('streetLine1') as string | null;
      streetLine2 = formData.get('streetLine2') as string | null;
      city = formData.get('city') as string | null;
      state = formData.get('state') as string | null;
      zipCode = formData.get('zipCode') as string | null;
      logoCleared = formData.get('logoCleared') === 'true';
      logoFile = formData.get('logo') as File | null;
    } else {
      const body = await request.json();
      legalName = body.legalName;
      taxId = body.taxId;
      phone = body.phone;
      email = body.email;
      isActive = body.isActive;
      streetLine1 = body.streetLine1;
      streetLine2 = body.streetLine2;
      city = body.city;
      state = body.state;
      zipCode = body.zipCode;
      logoCleared = body.logoCleared === true;
      logoFile = null;
    }

    const companyExists = await db.company.findUnique({
      where: { id },
      select: {
        logo: true,
        streetLine1: true,
        streetLine2: true,
        city: true,
        state: true,
        zipCode: true,
      },
    });

    if (!companyExists) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    let newLogoPath: string | undefined = undefined;
    let shouldUpdateLogo = false;

    if (logoFile && logoFile.size > 0) {
      newLogoPath = await saveLogo(logoFile);
      if (companyExists.logo) {
        await deleteLogo(companyExists.logo);
      }
      shouldUpdateLogo = true;
    } else if (logoCleared) {
      newLogoPath = '';
      if (companyExists.logo) {
        await deleteLogo(companyExists.logo);
      }
      shouldUpdateLogo = true;
    }

    const finalStreet1 =
      streetLine1 !== null && streetLine1 !== undefined ? streetLine1 : companyExists.streetLine1;
    const finalStreet2 =
      streetLine2 !== null && streetLine2 !== undefined ? streetLine2 : companyExists.streetLine2;
    const finalCity = city !== null && city !== undefined ? city : companyExists.city;
    const finalState = state !== null && state !== undefined ? state : companyExists.state;
    const finalZip = zipCode !== null && zipCode !== undefined ? zipCode : companyExists.zipCode;
    const finalAddress =
      [finalStreet1, finalStreet2, finalCity, finalState, finalZip].filter(Boolean).join(', ') ||
      null;

    const company = await db.company.update({
      where: { id },
      data: {
        legalName: legalName !== null && legalName !== undefined ? legalName : undefined,
        taxId: taxId !== null ? taxId : undefined,
        phone: phone !== null ? phone : undefined,
        email: email !== null ? email : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        streetLine1: streetLine1 !== null ? streetLine1 : undefined,
        streetLine2: streetLine2 !== null ? streetLine2 : undefined,
        city: city !== null ? city : undefined,
        state: state !== null ? state : undefined,
        zipCode: zipCode !== null ? zipCode : undefined,
        address: finalAddress,
        ...(shouldUpdateLogo && { logo: newLogoPath === '' ? null : newLogoPath }),
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
    const errMsg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getSessionUserId(request);
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
