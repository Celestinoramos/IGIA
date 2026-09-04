import "server-only";
import { getDb } from "@/db/client";
import { auditLog, events } from "@/db/schema";
import { newId } from "./ids";
import { logger } from "./logger";

type Actor = "ai" | "system" | "operator";

/** Append an immutable audit entry. Never throws into the caller's flow. */
export function recordAudit(params: {
  actor: Actor;
  action: string;
  entity?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .insert(auditLog)
      .values({
        id: newId("aud"),
        actor: params.actor,
        action: params.action,
        entity: params.entity ?? null,
        entityId: params.entityId ?? null,
        data: params.data ?? {},
      })
      .run();
  } catch (error) {
    logger.error("Failed to write audit log", { action: params.action, error: String(error) });
  }
}

/** Record a structured event used for optimization/attribution analysis. */
export function recordEvent(params: {
  type: string;
  leadId?: string;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .insert(events)
      .values({
        id: newId("evt"),
        leadId: params.leadId ?? null,
        type: params.type,
        data: params.data ?? {},
      })
      .run();
  } catch (error) {
    logger.error("Failed to write event", { type: params.type, error: String(error) });
  }
}
