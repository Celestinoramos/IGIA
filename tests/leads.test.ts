import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";

describe("lead dedupe & discovery", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("dedupes by handle and normalizes @/case", async () => {
    const { upsertDiscoveredLead } = await import("@/features/leads/repo");
    const a = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@Brecho_Da_Ana" });
    const b = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "brecho_da_ana" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.lead?.id).toBe(a.lead?.id);
  });

  it("skips blocklisted handles", async () => {
    const { upsertDiscoveredLead, addToBlocklist } = await import("@/features/leads/repo");
    addToBlocklist("@spammer", "prior_opt_out");
    const r = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@spammer" });
    expect(r.skipped).toBe(true);
    expect(r.lead).toBeNull();
  });

  it("scores an on-ICP profile above threshold", async () => {
    const { scoreLead } = await import("@/features/leads/scoring");
    const { loadBusinessConfig } = await import("@/config/business");
    const config = loadBusinessConfig();
    const score = scoreLead(
      { instagramHandle: "@loja", displayName: "Loja da Bela", bio: "loja de roupas, dona Bela", followerCount: 3000 },
      "customer",
      config,
    );
    expect(score.score).toBeGreaterThan(25);
    expect(score.profileType).toBe("owner");
  });
});
