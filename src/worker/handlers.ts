import "server-only";
import type { Job } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { PublicProfile } from "@/features/leads/scoring";
import type { Funnel } from "@/features/leads/states";
import { discoverLeads } from "@/features/campaigns/discovery";
import { runFirstContact } from "@/features/campaigns/first-contact";
import { processInbound, sendFollowup } from "@/features/conversations/service";
import { backupDatabase } from "@/lib/backup";

export type JobHandler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") throw new Error(`Job payload missing string "${key}"`);
  return value;
}

export const handlers: Record<string, JobHandler> = {
  discover_leads: async (payload) => {
    const funnel = requireString(payload, "funnel") as Funnel;
    const candidates = (payload.candidates as PublicProfile[] | undefined) ?? [];
    const result = discoverLeads(funnel, candidates);
    logger.info("discover_leads done", { funnel, ...result });
  },

  first_contact: async (payload) => {
    const leadId = requireString(payload, "leadId");
    const result = await runFirstContact(leadId);
    logger.info("first_contact done", { leadId, ...result });
  },

  process_inbound: async (payload) => {
    const leadId = requireString(payload, "leadId");
    const result = await processInbound(leadId);
    logger.info("process_inbound done", { leadId, ...result });
  },

  send_followup: async (payload) => {
    const leadId = requireString(payload, "leadId");
    const result = await sendFollowup(leadId);
    logger.info("send_followup done", { leadId, ...result });
  },

  backup_db: async () => {
    const path = backupDatabase();
    logger.info("backup_db done", { path });
  },
};

export function getHandler(type: string): JobHandler | null {
  return handlers[type] ?? null;
}
