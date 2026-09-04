import "server-only";
import type { Lead } from "@/db/schema";
import { getEnv } from "@/config/env";
import { MESSAGING_WINDOW_MS, nowMs } from "@/lib/time";
import { logger } from "@/lib/logger";

export interface WindowStatus {
  open: boolean;
  reason?: string;
}

/**
 * The Instagram Messaging API can only reply within 24h of the customer's last
 * message (error 10/2534022 otherwise). We never use the human_agent tag for
 * automation, so this window is a hard gate — no browser workaround.
 */
export function checkMessagingWindow(lead: Lead, at: number = nowMs()): WindowStatus {
  if (!lead.lastInboundAt) return { open: false, reason: "no_inbound_message" };
  const elapsed = at - lead.lastInboundAt;
  if (elapsed > MESSAGING_WINDOW_MS) return { open: false, reason: "window_expired" };
  return { open: true };
}

export interface ApiSendPrecheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Verify EVERYTHING before an API send: token/permissions, recipient identity,
 * messaging window, channel ownership, and do-not-contact. Any failure routes
 * to the exceptions queue — it must never trigger a browser fallback.
 */
export function precheckApiSend(lead: Lead): ApiSendPrecheck {
  if (lead.channelState === "do_not_contact") return { allowed: false, reason: "do_not_contact" };
  if (lead.channelState === "blocked") return { allowed: false, reason: "blocked" };
  if (lead.channelState !== "api_active" && lead.channelState !== "api_eligible") {
    return { allowed: false, reason: `channel_not_owned_by_api:${lead.channelState}` };
  }
  if (!lead.instagramUserId) return { allowed: false, reason: "missing_recipient_id" };
  const window = checkMessagingWindow(lead);
  if (!window.open) return { allowed: false, reason: window.reason };
  return { allowed: true };
}

export type ApiSendResult =
  | { ok: true; simulated: boolean; externalId: string }
  | { ok: false; error: string };

/**
 * Send a message via the official Graph API. When no page access token is set
 * (e.g. sandbox), it runs in simulated mode so the handoff flow is fully
 * exercisable without live Meta credentials.
 */
export async function sendApiMessage(lead: Lead, text: string): Promise<ApiSendResult> {
  const env = getEnv();
  const token = env.INSTAGRAM_PAGE_ACCESS_TOKEN;

  if (!token) {
    logger.info("API send simulated (no page access token configured)", { leadId: lead.id });
    return { ok: true, simulated: true, externalId: `sim_${Date.now()}_${lead.id}` };
  }

  try {
    const res = await fetch(`${env.INSTAGRAM_GRAPH_API_BASE}/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recipient: { id: lead.instagramUserId },
        message: { text },
        messaging_type: "RESPONSE",
      }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      return { ok: false, error: `graph_api_${res.status}: ${errorText.slice(0, 300)}` };
    }
    const json = (await res.json()) as { message_id?: string };
    return { ok: true, simulated: false, externalId: json.message_id ?? `api_${Date.now()}` };
  } catch (error) {
    return { ok: false, error: `graph_api_network_error: ${String(error)}` };
  }
}
