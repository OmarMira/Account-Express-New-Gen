import { readFileSync } from 'fs';
import { join } from 'path';

export type RBACContext = { userId: string; companyId: string; role: string };
export type PermissionCheck = { resource: string; action: string };

export function checkPermission(ctx: RBACContext, check: PermissionCheck): boolean {
  try {
    const configPath = join(process.cwd(), 'rules/rbac-config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    const allowedRoles = config.permissions[check.resource]?.[check.action] || [];
    return allowedRoles.includes(ctx.role);
  } catch (err) {
    console.error('[RBAC ERROR] Failed to check permissions:', err);
    return false;
  }
}

export function enforcePermission(ctx: RBACContext, check: PermissionCheck): void {
  if (!checkPermission(ctx, check)) {
    throw new Error(
      `403 Forbidden: Role '${ctx.role}' lacks '${check.action}' on '${check.resource}'`,
    );
  }
}
