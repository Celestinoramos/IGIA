import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { freshDb } from "./helpers";

describe("webhook verification & idempotency", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("verifies HMAC signatures and rejects tampering", async () => {
    const { verifyWebhookSignature } = await import("@/integrations/instagram/webhook");
    const secret = "app_secret";
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const sig = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(body + "x", sig, secret)).toBe(false);
    expect(verifyWebhookSignature(body, sig, "wrong")).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  it("completes the GET verification handshake", async () => {
    const { verifyWebhookChallenge } = await import("@/integrations/instagram/webhook");
    expect(verifyWebhookChallenge("subscribe", "tok", "12345", "tok")).toBe("12345");
    expect(verifyWebhookChallenge("subscribe", "bad", "12345", "tok")).toBeNull();
  });

  it("parses inbound events and skips echoes", async () => {
    const { parseInboundEvents } = await import("@/integrations/instagram/webhook");
    const events = parseInboundEvents({
      object: "instagram",
      entry: [
        { messaging: [{ sender: { id: "s1" }, recipient: { id: "r1" }, timestamp: 1, message: { mid: "m1", text: "oi" } }] },
        { messaging: [{ sender: { id: "s1" }, message: { mid: "m2", text: "echo", is_echo: true } }] },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].mid).toBe("m1");
  });

  it("is idempotent on redelivered message ids", async () => {
    const { upsertDiscoveredLead } = await import("@/features/leads/repo");
    const { addMessage } = await import("@/features/conversations/repo");
    const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@dup" }).lead!;
    const a = addMessage({ leadId: lead.id, direction: "inbound", channel: "api", body: "oi", externalId: "mid-1" });
    const b = addMessage({ leadId: lead.id, direction: "inbound", channel: "api", body: "oi", externalId: "mid-1" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    const { listMessages } = await import("@/features/conversations/repo");
    expect(listMessages(lead.id).filter((m) => m.externalId === "mid-1").length).toBe(1);
  });
});
