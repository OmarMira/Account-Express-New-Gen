import { z } from 'zod';
import { classificationStatusSchema, entityRoleSchema } from '../constants/entity-roles';

export const entityContextSchema = z.object({
  companyId: z.string().min(1),
  pattern: z.string().min(1).max(255),
  role: entityRoleSchema.nullable(),
  glAccountId: z.string().min(1).nullable().optional(),
  transactionDirection: z.string().nullable().optional(),
  classificationStatus: classificationStatusSchema.optional(),
  classificationConfidence: z.number().min(0).max(1).nullable().optional(),
});
