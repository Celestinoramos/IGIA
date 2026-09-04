import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";

describe("experiments", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("assigns a sticky variant per lead", async () => {
    const { createExperiment, assignForVariable } = await import("@/features/experiments/engine");
    const { upsertDiscoveredLead } = await import("@/features/leads/repo");
    createExperiment({
      name: "Opener",
      variable: "opener",
      variants: [
        { key: "control", isControl: true },
        { key: "warm" },
      ],
    });
    const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@e1" }).lead!;
    const first = assignForVariable("opener", lead.id);
    const second = assignForVariable("opener", lead.id);
    expect(first?.variant.id).toBe(second?.variant.id);
  });

  it("summarizes conversion per variant with a min-sample flag", async () => {
    const { createExperiment, assignForVariable, summarizeExperiment } = await import("@/features/experiments/engine");
    const { upsertDiscoveredLead } = await import("@/features/leads/repo");
    const { transitionLead } = await import("@/features/leads/state-machine");
    const { experiment } = createExperiment({
      name: "Opener",
      variable: "opener",
      minSampleSize: 1,
      variants: [{ key: "control", isControl: true }, { key: "warm" }],
    });
    const lead = upsertDiscoveredLead({ funnel: "customer", instagramHandle: "@e2" }).lead!;
    assignForVariable("opener", lead.id);
    transitionLead({ leadId: lead.id, pipeline: "qualified", actor: "system" });
    transitionLead({ leadId: lead.id, pipeline: "interested", actor: "system" });
    const summary = summarizeExperiment(experiment.id)!;
    expect(summary.reachedMinSample).toBe(true);
    const total = summary.variants.reduce((s, v) => s + v.assigned, 0);
    expect(total).toBe(1);
  });
});
