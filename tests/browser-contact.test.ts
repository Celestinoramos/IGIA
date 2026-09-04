import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";

async function makeQualifiedLead(handle: string): Promise<string> {
  const { upsertDiscoveredLead } = await import("@/features/leads/repo");
  const { transitionLead } = await import("@/features/leads/state-machine");
  const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: handle, displayName: "Loja", niche: "loja" }).lead!;
  transitionLead({ leadId: lead.id, pipeline: "qualified", actor: "system" });
  return lead.id;
}

describe("first contact via browser + duplicate-send lock", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("sends the first DM and awaits reply", async () => {
    const leadId = await makeQualifiedLead("@loja1");
    const { runFirstContact } = await import("@/features/campaigns/first-contact");
    const result = await runFirstContact(leadId);
    expect(result.status).toBe("sent");
    const { getLead } = await import("@/features/leads/repo");
    const { listMessages } = await import("@/features/conversations/repo");
    const lead = getLead(leadId)!;
    expect(lead.channelState).toBe("waiting_inbound_reply");
    expect(lead.pipelineState).toBe("contacted");
    expect(listMessages(leadId).filter((m) => m.channel === "browser").length).toBe(1);
  });

  it("does not send twice (duplicate-send lock)", async () => {
    const leadId = await makeQualifiedLead("@loja2");
    const { runFirstContact } = await import("@/features/campaigns/first-contact");
    await runFirstContact(leadId);
    const second = await runFirstContact(leadId);
    expect(second.status).toBe("skipped");
    const { listMessages } = await import("@/features/conversations/repo");
    expect(listMessages(leadId).filter((m) => m.channel === "browser" && m.direction === "outbound").length).toBe(1);
  });

  it("pauses the system and files an exception on browser outage", async () => {
    process.env.CHROME_CDP_URL = "http://127.0.0.1:9222/unavailable";
    const { resetEnvCache } = await import("@/config/env");
    resetEnvCache();
    const leadId = await makeQualifiedLead("@loja3");
    const { runFirstContact } = await import("@/features/campaigns/first-contact");
    await runFirstContact(leadId);
    const { isPaused } = await import("@/lib/system-state");
    const { countOpenExceptions } = await import("@/features/exceptions/repo");
    expect(isPaused()).toBe(true);
    expect(countOpenExceptions()).toBeGreaterThan(0);
  });

  it("respects the daily/warmup cap", async () => {
    process.env.MAX_DMS_PER_DAY = "1";
    const { resetEnvCache } = await import("@/config/env");
    resetEnvCache();
    const { checkBrowserPacing, incrementDmsSentToday } = await import("@/integrations/browser/pacing");
    incrementDmsSentToday();
    const gate = checkBrowserPacing();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("daily_limit_reached");
  });
});
