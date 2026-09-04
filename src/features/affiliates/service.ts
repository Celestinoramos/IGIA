import "server-only";
import { getLead } from "@/features/leads/repo";
import { transitionLead } from "@/features/leads/state-machine";
import { recordEvent } from "@/lib/observability";
import { ok, err, type Result } from "@/lib/result";

/**
 * Affiliate-specific pipeline progression. These stages are driven by external
 * signals (group entry, activation, referrals) rather than DMs. Optimization
 * targets affiliates that GENERATE ACTIVE CUSTOMERS, not mere group joins.
 */

export function markJoinedAffiliateGroup(leadId: string): Result<true, string> {
  const lead = getLead(leadId);
  if (!lead) return err("lead_not_found");
  if (lead.funnel !== "affiliate") return err("not_an_affiliate");
  const r = transitionLead({ leadId, pipeline: "joined_affiliate_group", actor: "system", reason: "joined_group" });
  if (!r.ok) return err(r.error);
  recordEvent({ type: "affiliate.joined_group", leadId });
  return ok(true);
}

export function markAffiliateActive(leadId: string): Result<true, string> {
  const lead = getLead(leadId);
  if (!lead) return err("lead_not_found");
  const r = transitionLead({ leadId, pipeline: "active_affiliate", actor: "system", reason: "affiliate_activated" });
  if (!r.ok) return err(r.error);
  recordEvent({ type: "affiliate.activated", leadId });
  return ok(true);
}

export function markAffiliateGeneratedCustomer(
  leadId: string,
  referredCustomerLeadId?: string,
): Result<true, string> {
  const lead = getLead(leadId);
  if (!lead) return err("lead_not_found");
  const r = transitionLead({ leadId, pipeline: "generated_customer", actor: "system", reason: "generated_customer" });
  if (!r.ok) return err(r.error);
  recordEvent({ type: "affiliate.generated_customer", leadId, data: { referredCustomerLeadId: referredCustomerLeadId ?? null } });
  return ok(true);
}
