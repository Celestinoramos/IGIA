import { describe, it, expect, beforeEach, vi } from "vitest";
import { freshDb } from "./helpers";

// Lets a test make lead matching blow up mid-ingestion.
const failure = { next: false };

vi.mock("@/features/leads/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/leads/repo")>();
  return {
    ...actual,
    matchLeadForInbound: (senderId: string) => {
      if (failure.next) {
        failure.next = false;
        throw new Error("simulated ingestion failure");
      }
      return actual.matchLeadForInbound(senderId);
    },
  };
});

describe("webhook ingestion ledger", () => {
  beforeEach(async () => {
    failure.next = false;
    await freshDb();
  });

  const event = { senderId: "ig_unknown", recipientId: "me", mid: "mid-ledger-1", text: "oi", timestamp: Date.now() };

  it("skips redelivered events", async () => {
    const { ingestWebhookEvents } = await import("@/features/conversations/service");
    expect(ingestWebhookEvents([event])).toEqual({ processed: 1, duplicates: 0, failed: 0 });
    expect(ingestWebhookEvents([event])).toEqual({ processed: 0, duplicates: 1, failed: 0 });
  });

  it("rolls back the ledger when ingestion fails so Meta's retry is processed", async () => {
    const { ingestWebhookEvents } = await import("@/features/conversations/service");
    failure.next = true;
    expect(ingestWebhookEvents([event])).toEqual({ processed: 0, duplicates: 0, failed: 1 });
    // The redelivery must not be mistaken for a duplicate.
    expect(ingestWebhookEvents([event])).toEqual({ processed: 1, duplicates: 0, failed: 0 });
  });
});
