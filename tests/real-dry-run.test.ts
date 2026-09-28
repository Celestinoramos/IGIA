import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshDb } from "./helpers";

// Stand-in for the operator's Chrome: connects, and "types" the DM without sending.
vi.mock("@/integrations/browser/real", () => ({
  RealBrowserDriver: class {
    readonly name = "real" as const;
    async connect() {
      return { ok: true };
    }
    async sendDirectMessage(params: { dryRun: boolean }) {
      return { ok: true, deliveredAt: Date.now(), dryRun: params.dryRun };
    }
    async close() {}
  },
}));

describe("dry run in the real browser", () => {
  beforeEach(async () => {
    await freshDb();
    process.env.BROWSER_DRIVER = "real";
    const { resetEnvCache } = await import("@/config/env");
    resetEnvCache();
  });

  it("leaves the lead pending and uncounted so it gets the real DM later", async () => {
    const { upsertDiscoveredLead, getLead } = await import("@/features/leads/repo");
    const { transitionLead } = await import("@/features/leads/state-machine");
    const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@preview", displayName: "Loja", niche: "loja" }).lead!;
    transitionLead({ leadId: lead.id, pipeline: "qualified", actor: "system" });

    const { runFirstContact } = await import("@/features/campaigns/first-contact");
    const result = await runFirstContact(lead.id);
    expect(result).toEqual({ status: "skipped", reason: "dry_run_preview" });

    const after = getLead(lead.id)!;
    expect(after.pipelineState).toBe("qualified");
    expect(after.channelState).toBe("browser_contact_pending");
    const { dmsSentToday } = await import("@/integrations/browser/pacing");
    expect(dmsSentToday()).toBe(0);
    const { listMessages } = await import("@/features/conversations/repo");
    expect(listMessages(lead.id)).toHaveLength(0);
  });
});
