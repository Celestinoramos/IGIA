import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";
import { assert } from "vitest";

async function contactedLead(handle: string, funnel: "customer" | "affiliate" = "customer"): Promise<string> {
  const { upsertDiscoveredLead } = await import("@/features/leads/repo");
  const { transitionLead } = await import("@/features/leads/state-machine");
  const lead = upsertDiscoveredLead({ funnel, instagramHandle: handle, displayName: "Loja", niche: "loja" }).lead!;
  transitionLead({ leadId: lead.id, pipeline: "qualified", actor: "system" });
  const { runFirstContact } = await import("@/features/campaigns/first-contact");
  const r = await runFirstContact(lead.id);
  assert.equal(r.status, "sent", `first contact result: ${JSON.stringify(r)}`);
  return lead.id;
}

async function bindInbound(handle: string, text: string): Promise<void> {
  const { getLeadByHandle } = await import("@/features/leads/repo");
  const { getDb } = await import("@/db/client");
  const { leads } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { ingestInbound } = await import("@/features/conversations/service");
  const lead = getLeadByHandle(handle)!;
  getDb().update(leads).set({ instagramUserId: `ig_${handle}` }).where(eq(leads.id, lead.id)).run();
  ingestInbound({ senderId: `ig_${handle}`, mid: newId("mid"), text, timestamp: Date.now() });
}

describe("browser → webhook → API handoff", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("hands channel ownership to the API on inbound reply", async () => {
    const leadId = await contactedLead("@lojaA");
    await bindInbound("@lojaA", "Oi, como funciona?");
    const { processInbound } = await import("@/features/conversations/service");
    await processInbound(leadId);
    const { getLead } = await import("@/features/leads/repo");
    const { listMessages } = await import("@/features/conversations/repo");
    const lead = getLead(leadId)!;
    expect(lead.channelState).toBe("api_active");
    const msgs = listMessages(leadId);
    expect(msgs.some((m) => m.direction === "inbound")).toBe(true);
    expect(msgs.some((m) => m.channel === "api" && m.direction === "outbound")).toBe(true);
    // Exactly one browser outbound — no duplicate across channels.
    expect(msgs.filter((m) => m.channel === "browser" && m.direction === "outbound").length).toBe(1);
  });

  it("routes pricing questions to WhatsApp without inventing rates", async () => {
    const leadId = await contactedLead("@lojaB");
    await bindInbound("@lojaB", "Quanto custa a taxa?");
    const { processInbound } = await import("@/features/conversations/service");
    await processInbound(leadId);
    const { getLead } = await import("@/features/leads/repo");
    const { listMessages } = await import("@/features/conversations/repo");
    expect(getLead(leadId)!.pipelineState).toBe("whatsapp_handoff");
    expect(listMessages(leadId).some((m) => m.body.includes("wa.me"))).toBe(true);
  });

  it("opts out permanently on a stop request", async () => {
    const leadId = await contactedLead("@lojaC");
    await bindInbound("@lojaC", "por favor pode parar de me enviar mensagem");
    const { processInbound } = await import("@/features/conversations/service");
    await processInbound(leadId);
    const { getLead, isBlocked } = await import("@/features/leads/repo");
    expect(getLead(leadId)!.channelState).toBe("do_not_contact");
    expect(isBlocked("@lojaC")).toBe(true);
  });

  it("closes the API window instead of falling back to the browser", async () => {
    const leadId = await contactedLead("@lojaD");
    await bindInbound("@lojaD", "oi");
    // Force the inbound timestamp older than the 24h window.
    const { getDb } = await import("@/db/client");
    const { leads } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    getDb().update(leads).set({ lastInboundAt: Date.now() - 25 * 60 * 60 * 1000 }).where(eq(leads.id, leadId)).run();
    const { processInbound } = await import("@/features/conversations/service");
    const res = await processInbound(leadId);
    expect(res.status).toBe("window_closed");
    const { getLead } = await import("@/features/leads/repo");
    expect(getLead(leadId)!.channelState).toBe("api_window_closed");
  });
});
