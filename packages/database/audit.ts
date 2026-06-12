import { prismaClient } from "./client";

interface AuditLogInput {
  workspaceId: string;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

export async function auditLog(input: AuditLogInput): Promise<void> {
  try {
    await prismaClient.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details: input.details ? JSON.stringify(input.details) : null,
        ip: input.ip,
      },
    });
  } catch (err) {
    console.error(`[audit] Failed to write audit log | action=${input.action} entity=${input.entity} entityId=${input.entityId} workspaceId=${input.workspaceId}:`, err);
  }
}
