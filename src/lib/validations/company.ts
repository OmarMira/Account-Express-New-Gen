import { z } from 'zod';

export const createCompanySchema = z.object({
  legalName: z.string().min(1, 'El nombre legal es requerido'),
  taxId: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z
    .string()
    .email('Formato de correo electrónico inválido')
    .optional()
    .nullable()
    .or(z.literal('')),
  logo: z.string().optional().nullable(),
});

export const updateCompanySchema = createCompanySchema.partial();

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
