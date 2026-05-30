import { db } from '../db';

export async function safeAuditLog(data: {
  companyId: string;
  userId: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: any;
}) {
  let entity = data.entity;
  if (!entity) {
    console.warn('⚠️ AuditLog sin entidad, aplicando fallback "System"');
    entity = 'System';
  }

  return db.auditLog.create({
    data: {
      companyId: data.companyId,
      userId: data.userId,
      action: data.action,
      entity: entity,
      entityId: data.entityId || null,
      details: data.details ? JSON.stringify(data.details) : null,
    },
  });
}
