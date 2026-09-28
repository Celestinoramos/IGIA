import "server-only";
import { getEnv } from "@/config/env";
import { MINUTE_MS, nowMs } from "@/lib/time";
import { logger } from "@/lib/logger";
import { recordEvent } from "@/lib/observability";
import { pauseSystem, isPaused, recordCircuitFailure, recordCircuitSuccess, isCircuitOpen } from "@/lib/system-state";
import { openException } from "@/features/exceptions/repo";
import { getLead } from "@/features/leads/repo";
import { transitionLead } from "@/features/leads/state-machine";
import { addMessage } from "@/features/conversations/repo";
import type { BrowserDriver } from "./types";
import { SimulatedBrowserDriver } from "./simulated";
import { RealBrowserDriver } from "./real";
import { browserMutex } from "./mutex";
import { checkBrowserPacing, incrementDmsSentToday, scheduleNextBrowserDm, typingDelayPerCharMs } from "./pacing";

const CIRCUIT = "browser";

export function getBrowserDriver(): BrowserDriver {
  return getEnv().BROWSER_DRIVER === "real" ? new RealBrowserDriver() : new SimulatedBrowserDriver();
}

export interface FirstContactInput {
  leadId: string;
  message: string;
  variantId?: string | null;
  jobId?: string;
}

export type FirstContactResult =
  | { status: "sent"; dryRun: boolean }
  | { status: "skipped"; reason: string }
  /** Temporarily blocked; the lead is still pending and should be retried at `retryAt`. */
  | { status: "deferred"; reason: string; retryAt: number }
  | { status: "failed"; reason: string };

/** How long to wait before retrying when paused or the browser circuit is open. */
const BLOCKED_RETRY_MS = 5 * MINUTE_MS;

/**
 * Send the FIRST DM via the browser. Enforces, in order: global pause, circuit
 * breaker, the duplicate-send lock (channel must still be pending), and human
 * pacing. Only one browser job runs at a time (mutex). On outage it pauses the
 * queue instead of opening a new Chrome; on failure it files an exception with
 * full diagnostics and routes the lead to human review.
 */
export async function sendFirstContactDm(input: FirstContactInput): Promise<FirstContactResult> {
  if (isPaused()) return { status: "deferred", reason: "system_paused", retryAt: nowMs() + BLOCKED_RETRY_MS };
  if (isCircuitOpen(CIRCUIT)) return { status: "deferred", reason: "circuit_open", retryAt: nowMs() + BLOCKED_RETRY_MS };

  const pacing = checkBrowserPacing();
  if (!pacing.allowed) {
    return {
      status: "deferred",
      reason: `${pacing.reason ?? "pacing"}(sent=${pacing.sentToday}/limit=${pacing.dailyLimit})`,
      retryAt: pacing.retryAt ?? nowMs() + BLOCKED_RETRY_MS,
    };
  }

  return browserMutex.runExclusive(async () => {
    // Duplicate-send lock: re-read inside the mutex; only send if still pending.
    const lead = getLead(input.leadId);
    if (!lead) return { status: "failed", reason: "lead_not_found" };
    if (lead.channelState !== "browser_contact_pending") {
      return { status: "skipped", reason: `channel_not_pending:${lead.channelState}` };
    }

    const driver = getBrowserDriver();
    const connection = await driver.connect();
    if (!connection.ok) {
      await driver.close().catch(() => undefined);
      if (connection.unavailable) {
        openException({
          leadId: lead.id,
          type: "browser_unavailable",
          reason: connection.error,
          data: { cdpUrl: getEnv().CHROME_CDP_URL },
        });
        pauseSystem("browser_unavailable", "system");
        recordEvent({ type: "browser.unavailable", leadId: lead.id, data: { error: connection.error } });
        // The lead was never contacted: retry once the operator fixes Chrome and resumes.
        return { status: "deferred", reason: connection.error, retryAt: nowMs() + BLOCKED_RETRY_MS };
      }
      return { status: "failed", reason: connection.error };
    }

    try {
      const result = await driver.sendDirectMessage({
        handle: lead.instagramHandle,
        message: input.message,
        typingDelayMs: typingDelayPerCharMs(),
        dryRun: getEnv().DRY_RUN,
        jobId: input.jobId,
      });

      if (!result.ok) {
        openException({
          leadId: lead.id,
          type: "browser_send_failed",
          reason: result.error,
          data: { artifacts: result.artifacts ?? {} },
        });
        transitionLead({ leadId: lead.id, channel: "human_review_required", actor: "system", reason: "browser_send_failed" });
        const opened = recordCircuitFailure(CIRCUIT);
        if (opened) pauseSystem("browser_error_spike", "system");
        return { status: "failed", reason: result.error };
      }

      recordCircuitSuccess(CIRCUIT);
      scheduleNextBrowserDm();

      // A dry run in the operator's real Chrome only types the message, it never
      // sends it. Leave the lead pending so it gets the real DM once DRY_RUN is
      // off, instead of marking it contacted. (The simulated driver still walks
      // the full funnel so the sandbox and demo work end to end.)
      if (result.dryRun && driver.name === "real") {
        recordEvent({ type: "browser.dm_previewed", leadId: lead.id, data: { variantId: input.variantId ?? null } });
        logger.info("Real DM previewed (dry-run); lead left pending", { leadId: lead.id });
        return { status: "skipped", reason: "dry_run_preview" };
      }

      // Record the outbound message and advance pipeline + channel atomically.
      addMessage({
        leadId: lead.id,
        direction: "outbound",
        channel: "browser",
        body: input.message,
        variantId: input.variantId ?? null,
      });
      incrementDmsSentToday();

      // qualified → contacted; pending → sent → waiting_inbound_reply.
      transitionLead({ leadId: lead.id, pipeline: "contacted", channel: "browser_contact_sent", actor: "ai", reason: "first_contact_sent", patch: { lastOutboundAt: nowMs() } });
      transitionLead({ leadId: lead.id, channel: "waiting_inbound_reply", actor: "system", reason: "awaiting_reply" });

      recordEvent({
        type: "browser.dm_sent",
        leadId: lead.id,
        data: { dryRun: result.dryRun, variantId: input.variantId ?? null },
      });
      logger.info("First-contact DM handled", { leadId: lead.id, dryRun: result.dryRun });
      return { status: "sent", dryRun: result.dryRun };
    } finally {
      await driver.close().catch(() => undefined);
    }
  });
}
