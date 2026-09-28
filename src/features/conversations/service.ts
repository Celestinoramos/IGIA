import "server-only";
import { loadBusinessConfig } from "@/config/business";
import { getEnv } from "@/config/env";
import { HOUR_MS, MESSAGING_WINDOW_MS, MINUTE_MS, nowMs } from "@/lib/time";
import { recordAudit, recordEvent } from "@/lib/observability";
import { logger } from "@/lib/logger";
import { recordCircuitFailure, recordCircuitSuccess, pauseSystem, isPaused } from "@/lib/system-state";
import { openException } from "@/features/exceptions/repo";
import { getLead, matchLeadForInbound, optOutLead } from "@/features/leads/repo";
import { transitionLead } from "@/features/leads/state-machine";
import type { PipelineState } from "@/features/leads/states";
import { addMessage, listMessages } from "./repo";
import { classifyIntent, decideReply, BudgetExceededError } from "@/integrations/openai/engine";
import type { ConversationContext, Decision } from "@/integrations/openai/types";
import { precheckApiSend, sendApiMessage, checkMessagingWindow } from "@/integrations/instagram/api";
import { recordWhatsappHandoff } from "@/integrations/whatsapp/handoff";
import { enqueue } from "@/worker/queue";
import { getDb } from "@/db/client";
import { webhookEvents, type Lead } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { InboundMessageEvent } from "@/integrations/instagram/webhook";

const CIRCUIT = "instagram_api";

export interface IngestResult {
  matched: boolean;
  leadId?: string;
  duplicate?: boolean;
}

/**
 * Ingest an inbound message from the webhook: match the lead, bind the Meta id,
 * record the message idempotently, and hand channel ownership to the API. This
 * is where the browser → API handoff happens.
 */
export function ingestInbound(event: {
  senderId: string;
  mid: string;
  text: string;
  timestamp: number;
}): IngestResult {
  const lead = matchLeadForInbound(event.senderId);
  if (!lead) {
    recordEvent({ type: "inbound.unmatched", data: { senderId: event.senderId } });
    return { matched: false };
  }

  const { created } = addMessage({
    leadId: lead.id,
    direction: "inbound",
    channel: "api",
    body: event.text,
    externalId: event.mid,
  });
  if (!created) return { matched: true, leadId: lead.id, duplicate: true };

  // Bind Meta identity and hand the channel to the API.
  transitionLead({
    leadId: lead.id,
    pipeline: lead.pipelineState === "contacted" ? "replied" : lead.pipelineState,
    channel: lead.channelState === "waiting_inbound_reply" || lead.channelState === "api_window_closed" ? "api_eligible" : lead.channelState,
    actor: "system",
    reason: "inbound_reply_received",
    patch: {
      instagramUserId: lead.instagramUserId ?? event.senderId,
      metaThreadId: lead.metaThreadId ?? `thread_${event.senderId}`,
      lastInboundAt: event.timestamp,
      // A fresh reply supersedes any follow-up nudge already scheduled.
      nextActionAt: null,
    },
  });

  recordEvent({ type: "inbound.received", leadId: lead.id, data: { mid: event.mid } });
  enqueue({ type: "process_inbound", payload: { leadId: lead.id }, dedupeKey: `process_inbound:${event.mid}`, priority: 5 });
  return { matched: true, leadId: lead.id };
}

/**
 * Record each webhook event in the idempotency ledger and ingest it, in one
 * transaction: if ingestion throws, the ledger row is rolled back too, so
 * Meta's retry is processed instead of being dropped as a duplicate.
 */
export function ingestWebhookEvents(events: InboundMessageEvent[]): { processed: number; duplicates: number; failed: number } {
  const db = getDb();
  const result = { processed: 0, duplicates: 0, failed: 0 };
  for (const event of events) {
    try {
      const fresh = db.transaction(() => {
        const ledger = db
          .insert(webhookEvents)
          .values({ id: newId("wh"), externalId: event.mid, payload: event as unknown as Record<string, unknown>, processedAt: nowMs() })
          .onConflictDoNothing()
          .returning()
          .get();
        if (!ledger) return false;
        ingestInbound(event);
        return true;
      });
      if (fresh) result.processed += 1;
      else {
        result.duplicates += 1;
        logger.info("Skipping duplicate webhook event", { mid: event.mid });
      }
    } catch (error) {
      result.failed += 1;
      logger.error("Webhook event ingestion failed", { mid: event.mid, error: String(error) });
    }
  }
  return result;
}

function buildContext(lead: Lead, inboundText?: string): ConversationContext {
  const history = listMessages(lead.id).map((m) => ({ direction: m.direction, body: m.body }));
  return {
    lead: {
      funnel: lead.funnel,
      handle: lead.instagramHandle,
      displayName: lead.displayName,
      niche: lead.niche,
      profileType: lead.profileType,
      pipelineState: lead.pipelineState,
      publicSignals: lead.publicSignals ?? null,
    },
    history,
    inboundText,
  };
}

/** Map an intent to the pipeline stage a replying lead should reach. */
function pipelineForIntent(lead: Lead, decision: Decision): PipelineState | undefined {
  switch (decision.action) {
    case "forward_whatsapp":
      return lead.funnel === "customer" ? "whatsapp_handoff" : "interested";
    case "close":
      return "closed";
    default:
      break;
  }
  switch (decision.intent) {
    case "interested":
    case "asked_pricing":
    case "asked_info":
    case "objection":
      return "interested";
    default:
      return undefined;
  }
}

/**
 * The autonomous decision step for an inbound reply: verify API eligibility,
 * decide the next action, send via the official API, and advance state. Never
 * falls back to the browser after handoff.
 */
export async function processInbound(leadId: string): Promise<{ status: string }> {
  if (isPaused()) return { status: "skipped_paused" };
  const config = loadBusinessConfig();
  const lead = getLead(leadId);
  if (!lead) return { status: "lead_not_found" };

  // Verify the messaging window before doing anything.
  const window = checkMessagingWindow(lead);
  if (!window.open) {
    transitionLead({ leadId, channel: "api_window_closed", actor: "system", reason: window.reason });
    openException({ leadId, type: "api_window_closed", reason: window.reason ?? "window_expired", data: {} });
    return { status: "window_closed" };
  }

  const lastInbound = listMessages(leadId).filter((m) => m.direction === "inbound").at(-1);
  const context = buildContext(lead, lastInbound?.body);

  let decision: Decision;
  try {
    // Classification is recorded as its own (fast-model) call for attribution.
    const intent = await classifyIntent(context, leadId);
    recordEvent({ type: "conversation.intent", leadId, data: { intent } });
    decision = await decideReply(context, config, leadId);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      openException({ leadId, type: "openai_budget_exceeded", reason: "monthly budget reached", data: {} });
      return { status: "budget_exceeded" };
    }
    const opened = recordCircuitFailure("openai");
    if (opened) pauseSystem("openai_error_spike", "system");
    openException({ leadId, type: "openai_error", reason: String(error), data: {} });
    return { status: "ai_error" };
  }

  recordEvent({ type: "conversation.decision", leadId, data: { intent: decision.intent, action: decision.action } });
  recordAudit({ actor: "ai", action: "conversation.decision", entity: "lead", entityId: leadId, data: { intent: decision.intent, action: decision.action, reasoning: decision.reasoning } });

  // Immediate, message-free actions:
  if (decision.intent === "opt_out") {
    optOutLead(leadId, "lead_requested_stop");
    // Still send a brief acknowledgement if within window.
    if (decision.message) await deliver(lead, decision.message, decision.intent);
    return { status: "opted_out" };
  }
  if (decision.action === "escalate_human" || (!decision.message && decision.action !== "wait" && decision.action !== "close")) {
    transitionLead({ leadId, channel: "human_review_required", actor: "ai", reason: decision.reasoning || "escalation" });
    openException({ leadId, type: "needs_human", reason: decision.reasoning || "AI requested human", data: { intent: decision.intent } });
    return { status: "escalated" };
  }
  if (decision.action === "wait" || decision.action === "schedule_followup") {
    scheduleFollowup(leadId);
    return { status: "followup_scheduled" };
  }
  if (decision.action === "close") {
    transitionLead({ leadId, pipeline: "closed", channel: "completed", actor: "ai", reason: decision.intent });
    return { status: "closed" };
  }

  // Message-bearing actions require an API send.
  if (!decision.message) return { status: "noop" };
  const sent = await deliver(lead, decision.message, decision.intent);
  if (!sent.ok) return { status: "send_failed" };

  // Advance pipeline based on the decision.
  const nextPipeline = pipelineForIntent(lead, decision);
  if (nextPipeline && nextPipeline !== lead.pipelineState) {
    transitionLead({ leadId, pipeline: nextPipeline, actor: "ai", reason: decision.intent });
  }
  if (decision.action === "forward_whatsapp") {
    const fresh = getLead(leadId);
    if (fresh) recordWhatsappHandoff(fresh, config);
  }
  return { status: "replied" };
}

/** Send a message via the official API and record it, guarding all invariants. */
async function deliver(
  lead: Lead,
  message: string,
  intent: string,
  variantId?: string | null,
): Promise<{ ok: boolean }> {
  const fresh = getLead(lead.id);
  if (!fresh) return { ok: false };
  const precheck = precheckApiSend(fresh);
  if (!precheck.allowed) {
    openException({ leadId: lead.id, type: "api_precheck_failed", reason: precheck.reason ?? "precheck", data: {} });
    if (precheck.reason === "window_expired") {
      transitionLead({ leadId: lead.id, channel: "api_window_closed", actor: "system", reason: "window_expired" });
    }
    return { ok: false };
  }

  const result = await sendApiMessage(fresh, message);
  if (!result.ok) {
    const opened = recordCircuitFailure(CIRCUIT);
    if (opened) pauseSystem("instagram_api_error_spike", "system");
    openException({ leadId: lead.id, type: "api_send_failed", reason: result.error, data: {} });
    return { ok: false };
  }
  recordCircuitSuccess(CIRCUIT);

  addMessage({ leadId: lead.id, direction: "outbound", channel: "api", body: message, intent, externalId: result.externalId, variantId: variantId ?? null });
  // First API reply takes channel ownership; subsequent ones keep it.
  if (fresh.channelState === "api_eligible") {
    transitionLead({ leadId: lead.id, channel: "api_active", actor: "ai", reason: "api_reply_sent", patch: { lastOutboundAt: nowMs() } });
  } else {
    transitionLead({ leadId: lead.id, actor: "ai", reason: "api_reply_sent", patch: { lastOutboundAt: nowMs() } });
  }
  recordEvent({ type: "api.reply_sent", leadId: lead.id, data: { simulated: result.simulated, intent } });
  logger.info("API reply sent", { leadId: lead.id, simulated: result.simulated });
  return { ok: true };
}

/**
 * Send a gentle follow-up on a quiet API conversation. Skips unless the API
 * owns the channel; respects the messaging window (closing it via exception if
 * expired). The message is a claim-free nudge.
 */
export async function sendFollowup(leadId: string, scheduledFor?: number): Promise<{ status: string }> {
  if (isPaused()) return { status: "skipped_paused" };
  const lead = getLead(leadId);
  if (!lead) return { status: "lead_not_found" };
  // A newer follow-up was scheduled since (the lead replied again): this one is stale.
  if (scheduledFor !== undefined && lead.nextActionAt !== scheduledFor) return { status: "skipped_superseded" };
  if (lead.channelState !== "api_active" && lead.channelState !== "api_eligible") return { status: "skipped_not_api_owned" };
  // If the lead already moved to a handoff/closed stage, no nudge is needed.
  if (["whatsapp_handoff", "registered", "active_customer", "closed"].includes(lead.pipelineState)) {
    return { status: "skipped_stage" };
  }
  const message = "Oi! Passando só pra saber se você chegou a ver minha mensagem. Se tiver qualquer dúvida, estou por aqui. 🙂";
  const sent = await deliver(lead, message, "followup");
  if (!sent.ok) return { status: "send_failed" };
  recordEvent({ type: "conversation.followup_sent", leadId });
  return { status: "followup_sent" };
}

const FOLLOWUP_DELAY_MS = 20 * HOUR_MS;
/** Safety margin so the nudge lands well before Meta's 24h window closes. */
const WINDOW_MARGIN_MS = HOUR_MS;

/**
 * Schedule a nudge inside the 24h messaging window (counted from the lead's
 * last message): the API cannot send after it closes, so a later follow-up
 * would always fail. If the window leaves no room, nothing is scheduled.
 */
export function scheduleFollowup(leadId: string): void {
  const lead = getLead(leadId);
  if (!lead) return;
  if (!lead.lastInboundAt) {
    recordEvent({ type: "conversation.followup_not_possible", leadId, data: { reason: "no_inbound_message" } });
    return;
  }
  const scale = getEnv().PACING_TIME_SCALE;
  const now = nowMs();
  // Keep a floor so it is always in the future, even under a zeroed test clock.
  const desired = now + Math.max(FOLLOWUP_DELAY_MS * scale, MINUTE_MS);
  const latest = lead.lastInboundAt + MESSAGING_WINDOW_MS - WINDOW_MARGIN_MS;
  const runAt = Math.min(desired, latest);
  if (runAt <= now) {
    recordEvent({ type: "conversation.followup_not_possible", leadId, data: { reason: "window_closing" } });
    return;
  }
  transitionLead({ leadId, actor: "ai", reason: "scheduled_followup", patch: { nextActionAt: runAt } });
  enqueue({ type: "send_followup", payload: { leadId, runAt }, runAt, dedupeKey: `followup:${leadId}:${runAt}` });
  recordEvent({ type: "conversation.followup_scheduled", leadId, data: { runAt } });
}
