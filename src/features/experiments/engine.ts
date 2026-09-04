import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  experiments,
  experimentVariants,
  experimentAssignments,
  leads,
  messages,
  type Experiment,
  type ExperimentVariant,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { recordEvent } from "@/lib/observability";
import { pipelineFor, type PipelineState } from "@/features/leads/states";

export interface VariantSpec {
  key: string;
  description?: string;
  payload?: Record<string, unknown>;
  weight?: number;
  isControl?: boolean;
}

export function createExperiment(input: {
  name: string;
  variable: string;
  variants: VariantSpec[];
  minSampleSize?: number;
}): { experiment: Experiment; variants: ExperimentVariant[] } {
  const db = getDb();
  return db.transaction((tx) => {
    const experiment = tx
      .insert(experiments)
      .values({
        id: newId("exp"),
        name: input.name,
        variable: input.variable,
        status: "running",
        minSampleSize: input.minSampleSize ?? 30,
      })
      .returning()
      .get();
    const variants = input.variants.map((v) =>
      tx
        .insert(experimentVariants)
        .values({
          id: newId("var"),
          experimentId: experiment.id,
          key: v.key,
          description: v.description ?? null,
          payload: v.payload ?? {},
          weight: v.weight ?? 1,
          isControl: v.isControl ?? false,
        })
        .returning()
        .get(),
    );
    return { experiment, variants };
  });
}

export function getActiveExperimentForVariable(variable: string): Experiment | null {
  return (
    getDb()
      .select()
      .from(experiments)
      .where(and(eq(experiments.variable, variable), eq(experiments.status, "running")))
      .get() ?? null
  );
}

function variantsOf(experimentId: string): ExperimentVariant[] {
  return getDb().select().from(experimentVariants).where(eq(experimentVariants.experimentId, experimentId)).all();
}

/** Deterministic-ish weighted pick with a control group; assignment is sticky. */
export function assignForVariable(
  variable: string,
  leadId: string,
): { experiment: Experiment; variant: ExperimentVariant } | null {
  const experiment = getActiveExperimentForVariable(variable);
  if (!experiment) return null;
  const db = getDb();

  const existing = db
    .select()
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentId, experiment.id), eq(experimentAssignments.leadId, leadId)))
    .get();
  const variants = variantsOf(experiment.id);
  if (variants.length === 0) return null;

  if (existing) {
    const variant = variants.find((v) => v.id === existing.variantId) ?? variants[0];
    return { experiment, variant };
  }

  const variant = weightedPick(variants);
  db.insert(experimentAssignments)
    .values({ id: newId("asg"), experimentId: experiment.id, leadId, variantId: variant.id })
    .onConflictDoNothing()
    .run();
  recordEvent({ type: "experiment.assigned", leadId, data: { experimentId: experiment.id, variantKey: variant.key } });
  return { experiment, variant };
}

function weightedPick(variants: ExperimentVariant[]): ExperimentVariant {
  const total = variants.reduce((s, v) => s + v.weight, 0);
  let roll = Math.random() * total;
  for (const v of variants) {
    roll -= v.weight;
    if (roll <= 0) return v;
  }
  return variants[variants.length - 1];
}

export interface VariantSummary {
  variantId: string;
  key: string;
  isControl: boolean;
  assigned: number;
  replied: number;
  interestedOrBeyond: number;
  conversionRate: number;
}

export interface ExperimentSummary {
  experiment: Experiment;
  reachedMinSample: boolean;
  variants: VariantSummary[];
}

/**
 * Compare variants by downstream conversion. We do NOT declare a winner here —
 * the panel shows the data and the min-sample flag; ramping is a human/agent
 * decision within approved limits.
 */
export function summarizeExperiment(experimentId: string): ExperimentSummary | null {
  const db = getDb();
  const experiment = db.select().from(experiments).where(eq(experiments.id, experimentId)).get();
  if (!experiment) return null;
  const variants = variantsOf(experimentId);
  const assignments = db.select().from(experimentAssignments).where(eq(experimentAssignments.experimentId, experimentId)).all();

  const summaries: VariantSummary[] = variants.map((variant) => {
    const leadIds = assignments.filter((a) => a.variantId === variant.id).map((a) => a.leadId);
    let replied = 0;
    let interestedOrBeyond = 0;
    for (const leadId of leadIds) {
      const lead = db.select().from(leads).where(eq(leads.id, leadId)).get();
      if (!lead) continue;
      const order = pipelineFor(lead.funnel);
      const idx = order.indexOf(lead.pipelineState);
      const repliedIdx = order.indexOf("replied" as PipelineState);
      const interestedIdx = order.indexOf("interested" as PipelineState);
      const hasInbound = db.select().from(messages).where(and(eq(messages.leadId, leadId), eq(messages.direction, "inbound"))).get();
      if (hasInbound || idx >= repliedIdx) replied += 1;
      if (idx >= interestedIdx) interestedOrBeyond += 1;
    }
    const assigned = leadIds.length;
    return {
      variantId: variant.id,
      key: variant.key,
      isControl: variant.isControl,
      assigned,
      replied,
      interestedOrBeyond,
      conversionRate: assigned > 0 ? interestedOrBeyond / assigned : 0,
    };
  });

  const totalAssigned = summaries.reduce((s, v) => s + v.assigned, 0);
  return {
    experiment,
    reachedMinSample: totalAssigned >= experiment.minSampleSize,
    variants: summaries,
  };
}

export function listExperiments(): Experiment[] {
  return getDb().select().from(experiments).all();
}
