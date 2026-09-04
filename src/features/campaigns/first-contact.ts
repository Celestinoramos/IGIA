import "server-only";
import { loadBusinessConfig } from "@/config/business";
import { getLead } from "@/features/leads/repo";
import { listMessages } from "@/features/conversations/repo";
import { draftOpener, BudgetExceededError } from "@/integrations/openai/engine";
import type { ConversationContext } from "@/integrations/openai/types";
import { assignForVariable } from "@/features/experiments/engine";
import { sendFirstContactDm, type FirstContactResult } from "@/integrations/browser";
import { openException } from "@/features/exceptions/repo";

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
      return { status: "skipped", reason: "budget_exceeded" };
    }
    openException({ leadId, type: "opener_draft_failed", reason: String(error), data: {} });
    return { status: "failed", reason: "opener_draft_failed" };
  }

  return sendFirstContactDm({
    leadId,
    message: opener,
    variantId: assignment?.variant.id ?? null,
  });
}
