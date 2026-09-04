import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { messages, type Message } from "@/db/schema";
import { newId } from "@/lib/ids";

export interface AddMessageInput {
  leadId: string;
  direction: "outbound" | "inbound";
  channel: "browser" | "api" | "system";
  body: string;
  variantId?: string | null;
  intent?: string | null;
  externalId?: string | null;
}

export interface AddMessageResult {
  created: boolean;
  message: Message;
}

/**
 * Persist a message. When `externalId` (a Meta message id) is present, the
 * unique index makes this idempotent: a redelivered webhook cannot create a
 * duplicate inbound row.
 */
export function addMessage(input: AddMessageInput): AddMessageResult {
  const db = getDb();
  if (input.externalId) {
    const existing = db
      .select()
      .from(messages)
      .where(eq(messages.externalId, input.externalId))
      .get();
    if (existing) return { created: false, message: existing };
  }
  const inserted = db
    .insert(messages)
    .values({
      id: newId("msg"),
      leadId: input.leadId,
      direction: input.direction,
      channel: input.channel,
      body: input.body,
      variantId: input.variantId ?? null,
      intent: input.intent ?? null,
      externalId: input.externalId ?? null,
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (inserted) return { created: true, message: inserted };
  // Conflict on externalId: return the existing row.
  const existing = db
    .select()
    .from(messages)
    .where(eq(messages.externalId, input.externalId ?? ""))
    .get();
  if (!existing) throw new Error("Message insert failed without a conflicting row");
  return { created: false, message: existing };
}

export function listMessages(leadId: string): Message[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.leadId, leadId))
    .orderBy(asc(messages.createdAt))
    .all();
}

export function lastMessage(leadId: string, direction?: "inbound" | "outbound"): Message | null {
  const db = getDb();
  const where = direction
    ? and(eq(messages.leadId, leadId), eq(messages.direction, direction))
    : eq(messages.leadId, leadId);
  return db.select().from(messages).where(where).orderBy(desc(messages.createdAt)).get() ?? null;
}
