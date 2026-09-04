import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";

describe("pipeline & channel state machine", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("allows forward pipeline moves and rejects backward ones", async () => {
    const { canTransitionPipeline } = await import("@/features/leads/state-machine");
    expect(canTransitionPipeline("customer", "discovered", "qualified")).toBe(true);
    expect(canTransitionPipeline("customer", "qualified", "discovered")).toBe(false);
    expect(canTransitionPipeline("customer", "interested", "closed")).toBe(true);
  });

  it("enforces legal channel transitions only", async () => {
    const { canTransitionChannel } = await import("@/features/leads/state-machine");
    expect(canTransitionChannel("browser_contact_pending", "browser_contact_sent")).toBe(true);
    expect(canTransitionChannel("waiting_inbound_reply", "api_eligible")).toBe(true);
    // Cannot jump straight from pending to api_active.
    expect(canTransitionChannel("browser_contact_pending", "api_active")).toBe(false);
    // do_not_contact is terminal.
    expect(canTransitionChannel("do_not_contact", "api_eligible")).toBe(false);
  });

  it("rejects illegal transitions atomically (no mutation)", async () => {
    const { upsertDiscoveredLead } = await import("@/features/leads/repo");
    const { transitionLead } = await import("@/features/leads/state-machine");
    const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@x" }).lead!;
    const res = transitionLead({ leadId: lead.id, channel: "api_active", actor: "system" });
    expect(res.ok).toBe(false);
    const { getLead } = await import("@/features/leads/repo");
    expect(getLead(lead.id)?.channelState).toBe("browser_contact_pending");
  });

  it("freezes do_not_contact leads from re-entry", async () => {
    const { upsertDiscoveredLead, optOutLead, getLead, isBlocked } = await import("@/features/leads/repo");
    const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@y" }).lead!;
    optOutLead(lead.id, "user_request");
    expect(getLead(lead.id)?.channelState).toBe("do_not_contact");
    expect(isBlocked("@y")).toBe(true);
    const { transitionLead } = await import("@/features/leads/state-machine");
    const res = transitionLead({ leadId: lead.id, channel: "api_eligible", actor: "system" });
    expect(res.ok).toBe(false);
  });
});
