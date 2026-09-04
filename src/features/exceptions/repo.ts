import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { exceptions, type ExceptionRow } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowMs } from "@/lib/time";
import { recordAudit } from "@/lib/observability";
import { logger } from "@/lib/logger";

export interface OpenExceptionInput {
  leadId?: string | null;
  type: string;
  reason: string;
  data?: Record<string, unknown>;
}

export function openException(input: OpenExceptionInput): ExceptionRow {
  const row = getDb()
    .insert(exceptions)
    .values({
      id: newId("exc"),
      leadId: input.leadId ?? null,
      type: input.type,
      reason: input.reason,
      data: input.data ?? {},
      status: "open",
    })
    .returning()
    .get();
  recordAudit({ actor: "system", action: "exception.open", entity: "exception", entityId: row.id, data: { type: input.type } });
  logger.warn("Exception opened", { type: input.type, reason: input.reason, leadId: input.leadId ?? null });
  return row;
}

export function listExceptions(status: "open" | "resolved" = "open"): ExceptionRow[] {
  return getDb()
    .select()
    .from(exceptions)
    .where(eq(exceptions.status, status))
    .orderBy(desc(exceptions.createdAt))
    .all();
}

export function countOpenExceptions(): number {
  return getDb().select().from(exceptions).where(eq(exceptions.status, "open")).all().length;
}

export function resolveException(id: string, actor: "operator" | "system"): void {
  getDb()
    .update(exceptions)
    .set({ status: "resolved", resolvedAt: nowMs() })
    .where(and(eq(exceptions.id, id), eq(exceptions.status, "open")))
    .run();
  recordAudit({ actor, action: "exception.resolve", entity: "exception", entityId: id });
}
