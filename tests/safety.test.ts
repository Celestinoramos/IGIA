import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";

describe("claims guard", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("blocks superlatives, guarantees and unverified claims", async () => {
    const { checkClaims } = await import("@/integrations/openai/claims");
    const { loadBusinessConfig } = await import("@/config/business");
    const config = loadBusinessConfig();
    expect(checkClaims("Temos a menor taxa do mercado!", config).ok).toBe(false);
    expect(checkClaims("Aprovação garantida em 24 horas.", config).ok).toBe(false);
    expect(checkClaims("Somos líder de mercado, número 1.", config).ok).toBe(false);
    // A verified-style, neutral message passes.
    expect(checkClaims("Oferecemos link de pagamento e maquininha para lojistas.", config).ok).toBe(true);
  });
});

describe("OpenAI budget cutoff", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("pauses the system when the monthly budget is exceeded", async () => {
    process.env.OPENAI_MONTHLY_BUDGET_USD = "0.0000001";
    const { resetEnvCache } = await import("@/config/env");
    resetEnvCache();
    const { recordAiCall, checkBudget } = await import("@/integrations/openai/budget");
    // Force a non-mock cost so spend crosses the tiny budget.
    recordAiCall({ purpose: "test", model: "gpt-4o", promptTokens: 1_000_000, completionTokens: 1_000_000, mock: false });
    const status = checkBudget();
    expect(status.withinBudget).toBe(false);
    const { isPaused } = await import("@/lib/system-state");
    expect(isPaused()).toBe(true);
  });
});

describe("circuit breaker", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("opens after repeated failures and resets on success", async () => {
    const { recordCircuitFailure, isCircuitOpen, recordCircuitSuccess } = await import("@/lib/system-state");
    let opened = false;
    for (let i = 0; i < 5; i++) opened = recordCircuitFailure("test") || opened;
    expect(opened).toBe(true);
    expect(isCircuitOpen("test")).toBe(true);
    recordCircuitSuccess("test");
    expect(isCircuitOpen("test")).toBe(false);
  });
});

describe("follow-up scheduling", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("schedules a durable follow-up job with a future runAt", async () => {
    const { upsertDiscoveredLead } = await import("@/features/leads/repo");
    const { transitionLead } = await import("@/features/leads/state-machine");
    const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@f1" }).lead!;
    // Move to a state where a follow-up makes sense.
    transitionLead({ leadId: lead.id, pipeline: "qualified", channel: "browser_contact_sent", actor: "system" });
    const { scheduleFollowup } = await import("@/features/conversations/service");
    scheduleFollowup(lead.id);
    const { listJobs } = await import("@/worker/queue");
    const followups = listJobs().filter((j) => j.type === "send_followup");
    expect(followups.length).toBe(1);
    expect(followups[0].runAt).toBeGreaterThan(Date.now());
    const { getLead } = await import("@/features/leads/repo");
    expect(getLead(lead.id)!.nextActionAt).not.toBeNull();
  });
});

describe("state encryption", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("round-trips encrypted values", async () => {
    const { encryptString, decryptString } = await import("@/lib/crypto");
    const enc = encryptString("session-cookie-value");
    expect(enc).not.toContain("session-cookie-value");
    expect(decryptString(enc)).toBe("session-cookie-value");
  });
});
