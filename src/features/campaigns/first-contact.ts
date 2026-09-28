import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs, leads } from "@/db/schema";
import { enqueue } from "@/worker/queue";
import { loadBusinessConfig } from "@/config/business";
import { getLead } from "@/features/leads/repo";
import { listMessages } from "@/features/conversations/repo";
import { draftOpener, BudgetExceededError } from "@/integrations/openai/engine";
import type { ConversationContext } from "@/integrations/openai/types";
import { assignForVariable } from "@/features/experiments/engine";
import { sendFirstContactDm, type FirstContactResult } from "@/integrations/browser";
import { openException } from "@/features/exceptions/repo";
import { HOUR_MS, MINUTE_MS, nowMs } from "@/lib/time";

/**
 * Prepare and send the first-contact DM: assign the opener experiment variant,
 * draft a short personal opener from real profile signals (claims-guarded),
 * then send via the browser with human pacing.
 */
export async function runFirstContact(leadId: string): Promise<FirstContactResult> {
  const config = loadBusinessConfig();
  const lead = getLead(leadId);
  if (!lead) return { status: "failed", reason: "lead_not_found" };
  if (lead.channelState !== "browser_contact_pending") {
    return { status: "skipped", reason: `channel_not_pending:${lead.channelState}` };
  }

  const assignment = assignForVariable("opener", leadId);
  const context: ConversationContext = {
    lead: {
      funnel: lead.funnel,
      handle: lead.instagramHandle,
      displayName: lead.displayName,
      niche: lead.niche,
      profileType: lead.profileType,
      pipelineState: lead.pipelineState,
      publicSignals: lead.publicSignals ?? null,
    },
    history: listMessages(leadId).map((m) => ({ direction: m.direction, body: m.body })),
    variant: assignment?.variant.payload,
  };

  let opener: string;
  try {
    opener = await draftOpener(context, config, leadId);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      openException({ leadId, type: "openai_budget_exceeded", reason: "monthly budget reached", data: {} });
      return { status: "deferred", reason: "budget_exceeded", retryAt: nowMs() + 6 * HOUR_MS };
    }
    openException({ leadId, type: "opener_draft_failed", reason: String(error), data: {} });
    return { status: "deferred", reason: "opener_draft_failed", retryAt: nowMs() + 30 * MINUTE_MS };
  }

  return sendFirstContactDm({
    leadId,
    message: opener,
    variantId: assignment?.variant.id ?? null,
  });
}

/**
 * Re-enqueue first contact for qualified leads that are still pending but have
 * no queued job (e.g. previewed in a real-Chrome dry run, or stranded by an
 * older build). Runs on worker startup. Returns how many were re-enqueued.
 */
export function requeueStrandedFirstContacts(): number {
  const db = getDb();
  const queued = new Set(
    db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(and(eq(jobs.type, "first_contact"), inArray(jobs.status, ["pending", "running"])))
      .all()
      .map((j) => j.payload.leadId as string | undefined),
  );
  const stranded = db
    .select({ id: leads.id, priority: leads.priority })
    .from(leads)
    .where(and(eq(leads.pipelineState, "qualified"), eq(leads.channelState, "browser_contact_pending")))
    .all()
    .filter((lead) => !queued.has(lead.id));
  const stamp = nowMs();
  for (const lead of stranded) {
    enqueue({
      type: "first_contact",
      payload: { leadId: lead.id },
      dedupeKey: `first_contact:${lead.id}:requeue:${stamp}`,
      priority: lead.priority,
    });
  }
  return stranded.length;
}
