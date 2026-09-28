import "server-only";
import type { Job } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { PublicProfile } from "@/features/leads/scoring";
import type { Funnel } from "@/features/leads/states";
import { discoverLeads } from "@/features/campaigns/discovery";
import { runFirstContact } from "@/features/campaigns/first-contact";
import { processInbound, sendFollowup } from "@/features/conversations/service";
import { backupDatabase } from "@/lib/backup";
import { DAY_MS, nowMs } from "@/lib/time";
import { enqueue } from "./queue";

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
    const result = discoverLeads(funnel, candidates, {
      source: typeof payload.source === "string" ? payload.source : undefined,
      qualifyAll: payload.qualifyAll === true,
    });
    logger.info("discover_leads done", { funnel, ...result });
  },

  first_contact: async (payload, job) => {
    const leadId = requireString(payload, "leadId");
    const result = await runFirstContact(leadId);
    logger.info("first_contact done", { leadId, ...result });
    // Blocked by hours, caps, spacing, pause or an outage: the lead was not
    // contacted, so try again later instead of leaving it pending forever.
    if (result.status === "deferred") {
      enqueue({
        type: "first_contact",
        payload: { leadId },
        runAt: result.retryAt,
        dedupeKey: `first_contact:${leadId}:${result.retryAt}`,
        priority: job.priority,
      });
    }
  },

  process_inbound: async (payload) => {
    const leadId = requireString(payload, "leadId");
    const result = await processInbound(leadId);
    logger.info("process_inbound done", { leadId, ...result });
  },

  send_followup: async (payload) => {
    const leadId = requireString(payload, "leadId");
    const scheduledFor = typeof payload.runAt === "number" ? payload.runAt : undefined;
    const result = await sendFollowup(leadId, scheduledFor);
    logger.info("send_followup done", { leadId, ...result });
  },

  backup_db: async () => {
    const path = backupDatabase();
    logger.info("backup_db done", { path });
    // Keep backups daily even when the worker runs for days without restarting.
    const next = nowMs() + DAY_MS;
    enqueue({ type: "backup_db", runAt: next, dedupeKey: `backup_db:${new Date(next).toISOString().slice(0, 10)}` });
  },
};

export function getHandler(type: string): JobHandler | null {
  return handlers[type] ?? null;
}
