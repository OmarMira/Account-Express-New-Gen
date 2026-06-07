import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { saveLogo, deleteLogo } from '@/lib/uploads/logo-service';
import { updateAdminCompanySchema } from '@/lib/validations/admin';
import { parseAdminBody } from '@/lib/parse-admin-body';

export const PUT = apiHandler(
  async (request: NextRequest, context: RouteContext) => {
    const { userId } = requireCompanyContext();
    const { id } = await context.params;

    const contentType = request.headers.get('content-type') || '';
    const isFormData = contentType.includes('multipart/form-data');

    let logoCleared = false;
    let logoFile: File | null = null;

    if (isFormData) {
      const formData = await request.clone().formData();
      logoCleared = formData.get('logoCleared') === 'true';
    }

    const parsed = await parseAdminBody(request, updateAdminCompanySchema, (raw) => ({
      ...raw,
      isActive: raw.isActive !== undefined ? raw.isActive === 'true' : undefined,
    }));
    if (!parsed.ok) return parsed.error;

    logoFile = parsed.body.files.get('logo') ?? null;

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

    let newLogoPath: string | undefined;
    let shouldUpdateLogo = false;

    if (logoFile) {
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

    const fields = parsed.body.data;

    const finalStreet1 = fields.streetLine1 ?? companyExists.streetLine1;
    const finalStreet2 = fields.streetLine2 ?? companyExists.streetLine2;
    const finalCity = fields.city ?? companyExists.city;
    const finalState = fields.state ?? companyExists.state;
    const finalZip = fields.zipCode ?? companyExists.zipCode;
    const finalAddress =
      [finalStreet1, finalStreet2, finalCity, finalState, finalZip].filter(Boolean).join(', ') ||
      null;

    const data: Record<string, unknown> = {};
    if (fields.legalName !== undefined) data.legalName = fields.legalName;
    if (fields.taxId !== undefined) data.taxId = fields.taxId;
    if (fields.phone !== undefined) data.phone = fields.phone;
    if (fields.email !== undefined) data.email = fields.email;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.streetLine1 !== undefined) data.streetLine1 = fields.streetLine1;
    if (fields.streetLine2 !== undefined) data.streetLine2 = fields.streetLine2;
    if (fields.city !== undefined) data.city = fields.city;
    if (fields.state !== undefined) data.state = fields.state;
    if (fields.zipCode !== undefined) data.zipCode = fields.zipCode;
    data.address = finalAddress;
    if (shouldUpdateLogo) {
      data.logo = newLogoPath === '' ? null : newLogoPath;
    }

    const company = await db.company.update({
      where: { id },
      data,
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
  },
  { requireSuperAdmin: true },
);

export const DELETE = apiHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const { userId } = requireCompanyContext();
    const { id } = await context.params;

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
  },
  { requireSuperAdmin: true },
);
