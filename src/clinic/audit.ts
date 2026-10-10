import { run, type DB } from "@/lib/db";

export interface Actor {
  userId: number | null;
  name: string; // "نهى السيد", "patient:whatsapp", "system"
}

export const SYSTEM: Actor = { userId: null, name: "system" };

export function audit(db: DB, tenantId: number, actor: Actor, action: string, entity: string, entityId: number | null, details?: unknown) {
  run(
    db,
    "INSERT INTO audit_log (tenant_id, user_id, actor, action, entity, entity_id, details) VALUES (?,?,?,?,?,?,?)",
    tenantId,
    actor.userId,
    actor.name,
    action,
    entity,
    entityId,
    details === undefined ? null : JSON.stringify(details),
  );
}
