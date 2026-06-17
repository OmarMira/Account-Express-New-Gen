import { z } from 'zod';

export const ENTITY_ROLES = [
  'INQUILINO',
  'PROVEEDOR',
  'SOCIO',
  'CLIENTE',
  'EMPLEADO',
  'TARJETA_CREDITO',
  'PRESTAMO',
  'GASTO_OPERATIVO',
  'INGRESO',
  'OTRO',
  'IGNORADA',
] as const;

export type EntityRole = (typeof ENTITY_ROLES)[number];

/** Roles exposed to user-facing dropdowns (excludes internal IGNORADA). */
export const UI_ROLES = ENTITY_ROLES.filter((r) => r !== 'IGNORADA');

/** Zod enum helper for validating role fields. */
export const entityRoleSchema = z.enum(ENTITY_ROLES);
