import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshDb } from "./helpers";

// The backup test is about rescheduling; don't write real files into backups/.
vi.mock("@/lib/backup", () => ({ backupDatabase: () => "backups/test.db" }));

async function makeQualifiedLead(handle: string): Promise<string> {
  const { upsertDiscoveredLead } = await import("@/features/leads/repo");
  const { transitionLead } = await import("@/features/leads/state-machine");
  const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: handle, displayName: "Loja", niche: "loja" }).lead!;
  transitionLead({ leadId: lead.id, pipeline: "qualified", actor: "system" });
  return lead.id;
}

async function pendingFirstContactJobs(leadId: string) {
  const { listJobs } = await import("@/worker/queue");
  return listJobs().filter((j) => j.type === "first_contact" && j.status === "pending" && j.payload.leadId === leadId);
}

describe("first-contact pacing & rescheduling", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("spaces DMs out by the configured interval", async () => {
    process.env.PACING_TIME_SCALE = "1";
    const { resetEnvCache } = await import("@/config/env");
    resetEnvCache();
    const { checkBrowserPacing, scheduleNextBrowserDm } = await import("@/integrations/browser/pacing");
    expect(checkBrowserPacing().allowed).toBe(true);
    scheduleNextBrowserDm();
    const gate = checkBrowserPacing();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("min_interval");
    // MIN/MAX_SECONDS_BETWEEN_DMS are 90–240s in the test env.
    expect(gate.retryAt! - Date.now()).toBeGreaterThanOrEqual(89_000);
    expect(gate.retryAt! - Date.now()).toBeLessThanOrEqual(240_000);
  });

  it("re-enqueues a first contact blocked by the daily cap instead of dropping it", async () => {
    process.env.MAX_DMS_PER_DAY = "1";
    const { resetEnvCache } = await import("@/config/env");
    resetEnvCache();
    const { incrementDmsSentToday } = await import("@/integrations/browser/pacing");
    incrementDmsSentToday();
    const leadId = await makeQualifiedLead("@capped");
    const { enqueue } = await import("@/worker/queue");
    enqueue({ type: "first_contact", payload: { leadId }, dedupeKey: `first_contact:${leadId}` });
    const { drainQueue } = await import("@/worker/runner");
    await drainQueue();

    const { getLead } = await import("@/features/leads/repo");
    expect(getLead(leadId)!.channelState).toBe("browser_contact_pending");
    const retries = await pendingFirstContactJobs(leadId);
    expect(retries).toHaveLength(1);
    expect(retries[0].runAt).toBeGreaterThan(Date.now());
  });

  it("re-enqueues stranded qualified leads on worker startup, once", async () => {
    const stranded = await makeQualifiedLead("@stranded");
    const { requeueStrandedFirstContacts } = await import("@/features/campaigns/first-contact");
    expect(requeueStrandedFirstContacts()).toBe(1);
    expect(await pendingFirstContactJobs(stranded)).toHaveLength(1);
    // Already queued: a second startup must not duplicate it.
    expect(requeueStrandedFirstContacts()).toBe(0);
  });

  it("schedules the next daily backup after one runs", async () => {
    const { enqueue, listJobs } = await import("@/worker/queue");
    enqueue({ type: "backup_db" });
    const { drainQueue } = await import("@/worker/runner");
    await drainQueue();
    const { DAY_MS } = await import("@/lib/time");
    const next = listJobs().filter((j) => j.type === "backup_db" && j.status === "pending");
    expect(next).toHaveLength(1);
    expect(next[0].runAt).toBeGreaterThan(Date.now() + DAY_MS - 60_000);
  });
});
