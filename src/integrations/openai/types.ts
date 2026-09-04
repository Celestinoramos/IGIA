import type { Intent, Action } from "@/features/conversations/intents";
import type { Funnel, PipelineState, ProfileType } from "@/features/leads/states";

export interface ConversationLead {
  funnel: Funnel;
  handle: string;
  displayName: string | null;
  niche: string | null;
  profileType: ProfileType;
  pipelineState: PipelineState;
  publicSignals: Record<string, unknown> | null;
}

export interface HistoryItem {
  direction: "inbound" | "outbound";
  body: string;
}

export interface ConversationContext {
  lead: ConversationLead;
  history: HistoryItem[];
  inboundText?: string;
  /** Experiment variant payload influencing tone/CTA (never claims). */
  variant?: Record<string, unknown>;
}

export interface Decision {
  intent: Intent;
  action: Action;
  message: string | null;
  reasoning: string;
}

export interface UsageStats {
  model: string;
  promptTokens: number;
  completionTokens: number;
  mock: boolean;
}
