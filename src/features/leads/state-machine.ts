import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { leads, type Lead } from "@/db/schema";
import { nowMs } from "@/lib/time";
import { recordAudit, recordEvent } from "@/lib/observability";
import { ok, err, type Result } from "@/lib/result";
import {
  type ChannelState,
  type PipelineState,
  type Funnel,
  pipelineFor,
} from "./states";

/**
 * Channel transitions are explicit: only the pairs below are legal. This is
 * what enforces the browser → API handoff and prevents illegal jumps such as
 * sending on the browser after the API owns the thread.
 */
const CHANNEL_TRANSITIONS: Record<ChannelState, ReadonlySet<ChannelState>> = {
  browser_contact_pending: new Set(["browser_contact_sent", "human_review_required", "do_not_contact", "blocked"]),
  browser_contact_sent: new Set(["waiting_inbound_reply", "human_review_required", "blocked", "do_not_contact"]),
  waiting_inbound_reply: new Set(["api_eligible", "api_window_closed", "human_review_required", "do_not_contact", "blocked"]),
  api_eligible: new Set(["api_active", "api_window_closed", "human_review_required", "do_not_contact"]),
  api_active: new Set(["api_active", "api_window_closed", "completed", "human_review_required", "do_not_contact"]),
  api_window_closed: new Set(["api_eligible", "human_review_required", "do_not_contact", "completed"]),
  human_review_required: new Set([
    "api_eligible",
    "api_active",
    "waiting_inbound_reply",
    "completed",
    "do_not_contact",
    "blocked",
    "browser_contact_pending",
  ]),
  // Terminal / near-terminal states:
  do_not_contact: new Set([]),
  blocked: new Set(["human_review_required", "do_not_contact"]),
  completed: new Set([]),
};

export function canTransitionChannel(from: ChannelState, to: ChannelState): boolean {
  if (from === to) return CHANNEL_TRANSITIONS[from].has(to);
  return CHANNEL_TRANSITIONS[from].has(to);
}

/** Pipeline may only move forward in its ordered list, or jump to `closed`. */
export function canTransitionPipeline(
  funnel: Funnel,
  from: PipelineState,
  to: PipelineState,
): boolean {
  if (to === "closed") return true;
  const order = pipelineFor(funnel);
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx;
}

export interface TransitionInput {
  leadId: string;
  pipeline?: PipelineState;
  channel?: ChannelState;
  actor: "ai" | "system" | "operator";
  reason?: string;
  patch?: Partial<Pick<Lead, "metaThreadId" | "instagramUserId" | "nextActionAt" | "lastInboundAt" | "lastOutboundAt">>;
}

/**
 * Atomic, auditable state transition. Validates both dimensions against the
 * lead's CURRENT state inside a single transaction, then records an event +
 * audit entry. Illegal transitions are rejected without mutating anything.
 */
export function transitionLead(input: TransitionInput): Result<Lead, string> {
  const db = getDb();
  return db.transaction((tx) => {
    const lead = tx.select().from(leads).where(eq(leads.id, input.leadId)).get();
    if (!lead) return err(`Lead not found: ${input.leadId}`);

    // A lead on do_not_contact is frozen — no re-entry by any path.
    if (lead.channelState === "do_not_contact" && input.channel !== "do_not_contact") {
      return err("Lead is on do_not_contact and cannot be re-engaged");
    }

    const nextPipeline = input.pipeline ?? lead.pipelineState;
    const nextChannel = input.channel ?? lead.channelState;

    if (input.pipeline && input.pipeline !== lead.pipelineState) {
      if (!canTransitionPipeline(lead.funnel, lead.pipelineState, input.pipeline)) {
        return err(`Illegal pipeline transition ${lead.pipelineState} → ${input.pipeline}`);
      }
    }
    if (input.channel && input.channel !== lead.channelState) {
      if (!canTransitionChannel(lead.channelState, input.channel)) {
        return err(`Illegal channel transition ${lead.channelState} → ${input.channel}`);
      }
    }

    const updated = tx
      .update(leads)
      .set({
        pipelineState: nextPipeline,
        channelState: nextChannel,
        ...(input.patch ?? {}),
        updatedAt: nowMs(),
      })
      .where(eq(leads.id, input.leadId))
      .returning()
      .get();

    recordEvent({
      type: "lead.transition",
      leadId: lead.id,
      data: {
        fromPipeline: lead.pipelineState,
        toPipeline: nextPipeline,
        fromChannel: lead.channelState,
        toChannel: nextChannel,
        reason: input.reason ?? null,
      },
    });
    recordAudit({
      actor: input.actor,
      action: "lead.transition",
      entity: "lead",
      entityId: lead.id,
      data: { toPipeline: nextPipeline, toChannel: nextChannel, reason: input.reason ?? null },
    });

    return ok(updated);
  });
}
