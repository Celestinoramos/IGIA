/** Interpreted intent of an inbound message. Internal values in English. */
export const INTENTS = [
  "interested",
  "asked_info",
  "asked_pricing",
  "wants_whatsapp",
  "not_the_owner",
  "will_forward",
  "objection",
  "not_interested",
  "opt_out",
  "ambiguous",
  "needs_human",
] as const;
export type Intent = (typeof INTENTS)[number];

/** Actions the conversation engine may decide to take. */
export const ACTIONS = [
  "reply",
  "ask",
  "present",
  "handle_objection",
  "forward_whatsapp",
  "wait",
  "schedule_followup",
  "close",
  "escalate_human",
] as const;
export type Action = (typeof ACTIONS)[number];

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

export function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}
