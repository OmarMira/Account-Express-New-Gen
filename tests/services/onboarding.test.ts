import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { completeOnboarding } from '@/services/onboarding.service';
import { createTestCompany, clearDatabase } from '../helpers/factories';
import { db } from '@/lib/db';

describe('OnboardingService', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterEach(async () => {
    await clearDatabase();
  });

  it('debe inicializar el onboarding contable de la empresa exitosamente', async () => {
    const company = await createTestCompany();
    
    // Ejecutar el onboarding service
    const result = await completeOnboarding(
      company.id,
      1 // Enero
    );

    expect(result.success).toBe(true);
    expect(result.company.isOnboardingComplete).toBe(true);

    // 1. Verificar periodo fiscal
    const fiscalPeriods = await db.fiscalPeriod.findMany({
      where: { companyId: company.id }
    });
    expect(fiscalPeriods).toHaveLength(1);
    expect(fiscalPeriods[0].name).toBe('FY 2025');
    
    // 2. Verificar que se crearon cuentas del catálogo
    const accountsCount = await db.glAccount.count({
      where: { companyId: company.id }
    });
    expect(accountsCount).toBeGreaterThan(10); // catálogo básico cargado
  });

  it('debe inicializar el onboarding contable para un año anterior (2024) exitosamente', async () => {
    const company = await createTestCompany();
    
    // Ejecutar el onboarding service especificando el año 2024
    const result = await completeOnboarding(
      company.id,
      1, // Enero
      2024 // Año de inicio
    );

    expect(result.success).toBe(true);
    expect(result.company.isOnboardingComplete).toBe(true);

    // 1. Verificar periodo fiscal de 2024
    const fiscalPeriods = await db.fiscalPeriod.findMany({
      where: { companyId: company.id }
    });
    expect(fiscalPeriods).toHaveLength(1);
    expect(fiscalPeriods[0].name).toBe('FY 2024');
  });
});
