/**
 * Pipeline and channel are SEPARATE dimensions of a lead's state.
 * Internal values are English; the panel translates them to PT-BR.
 */

export const FUNNELS = ["customer", "affiliate"] as const;
export type Funnel = (typeof FUNNELS)[number];

export const CUSTOMER_PIPELINE = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "whatsapp_handoff",
  "registered",
  "active_customer",
  "closed",
] as const;
export type CustomerPipelineState = (typeof CUSTOMER_PIPELINE)[number];

export const AFFILIATE_PIPELINE = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "joined_affiliate_group",
  "active_affiliate",
  "generated_customer",
  "closed",
] as const;
export type AffiliatePipelineState = (typeof AFFILIATE_PIPELINE)[number];

export type PipelineState = CustomerPipelineState | AffiliatePipelineState;

export const CHANNEL_STATES = [
  "browser_contact_pending",
  "browser_contact_sent",
  "waiting_inbound_reply",
  "api_eligible",
  "api_active",
  "api_window_closed",
  "human_review_required",
  "do_not_contact",
  "blocked",
  "completed",
] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

export const PROFILE_TYPES = [
  "store",
  "employee",
  "owner",
  "decision_maker",
  "creator",
  "unknown",
] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export function pipelineFor(funnel: Funnel): readonly PipelineState[] {
  return funnel === "customer" ? CUSTOMER_PIPELINE : AFFILIATE_PIPELINE;
}

/** Terminal channel states never send again on that channel. */
export const TERMINAL_CHANNEL_STATES: ReadonlySet<ChannelState> = new Set([
  "do_not_contact",
  "blocked",
  "completed",
]);
