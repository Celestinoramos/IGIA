import "server-only";
import type { BusinessConfig } from "@/config/business";
import type { Lead } from "@/db/schema";
import { recordEvent } from "@/lib/observability";

/**
 * WhatsApp / affiliate-group handoff. Interested store owners go to the
 * WhatsApp link; interested creators go to the affiliate group link. Sending
 * happens inside the conversation reply; this records the pipeline handoff.
 */
export function handoffLinkFor(lead: Lead, config: BusinessConfig): string {
  return lead.funnel === "affiliate" ? config.links.affiliateGroup : config.links.whatsapp;
}

export function recordWhatsappHandoff(lead: Lead, config: BusinessConfig): void {
  recordEvent({
    type: "whatsapp.handoff",
    leadId: lead.id,
    data: { funnel: lead.funnel, link: handoffLinkFor(lead, config) },
  });
}
