import "server-only";
import { getDb } from "@/db/client";
import { leads, aiCalls } from "@/db/schema";
import { getEnv } from "@/config/env";
import { loadBusinessConfig, hasPlaceholders, type BusinessConfig } from "@/config/business";
import { getPauseState, type PauseState } from "@/lib/system-state";
import { monthlySpendUsd } from "@/integrations/openai/budget";
import { checkBrowserPacing } from "@/integrations/browser/pacing";
import { countOpenExceptions } from "@/features/exceptions/repo";
import { jobCountsByStatus } from "@/worker/queue";
import {
  CUSTOMER_PIPELINE,
  AFFILIATE_PIPELINE,
  CHANNEL_STATES,
  type Funnel,
  type PipelineState,
} from "@/features/leads/states";

export interface FunnelMetrics {
  funnel: Funnel;
  total: number;
  byPipeline: Record<string, number>;
}

export interface DashboardMetrics {
  pause: PauseState;
  config: BusinessConfig;
  configHasPlaceholders: boolean;
  totals: {
    leads: number;
    contacted: number;
    replied: number;
    interested: number;
    activeCustomers: number;
    activeAffiliates: number;
    generatedCustomers: number;
  };
  funnels: FunnelMetrics[];
  channelCounts: Record<string, number>;
  pacing: { sentToday: number; dailyLimit: number; maxPerDay: number; withinHours: boolean };
  budget: { spend: number; budget: number; pct: number };
  cost: { perLead: number; perActiveCustomer: number };
  openExceptions: number;
  jobs: Record<string, number>;
}

export function getDashboardMetrics(): DashboardMetrics {
  const db = getDb();
  const allLeads = db.select().from(leads).all();
  const config = loadBusinessConfig();
  const env = getEnv();

  const funnels: FunnelMetrics[] = (["customer", "affiliate"] as Funnel[]).map((funnel) => {
    const order = funnel === "customer" ? CUSTOMER_PIPELINE : AFFILIATE_PIPELINE;
    const byPipeline: Record<string, number> = {};
    for (const stage of order) byPipeline[stage] = 0;
    const rows = allLeads.filter((l) => l.funnel === funnel);
    for (const l of rows) byPipeline[l.pipelineState] = (byPipeline[l.pipelineState] ?? 0) + 1;
    return { funnel, total: rows.length, byPipeline };
  });

  const channelCounts: Record<string, number> = {};
  for (const c of CHANNEL_STATES) channelCounts[c] = 0;
  for (const l of allLeads) channelCounts[l.channelState] = (channelCounts[l.channelState] ?? 0) + 1;

  const countStage = (stage: PipelineState) => allLeads.filter((l) => l.pipelineState === stage).length;
  const activeCustomers = countStage("active_customer");
  const totals = {
    leads: allLeads.length,
    contacted: allLeads.filter((l) => l.pipelineState !== "discovered" && l.pipelineState !== "qualified").length,
    replied: allLeads.filter((l) => ["replied", "interested", "whatsapp_handoff", "registered", "active_customer", "joined_affiliate_group", "active_affiliate", "generated_customer"].includes(l.pipelineState)).length,
    interested: countStage("interested"),
    activeCustomers,
    activeAffiliates: countStage("active_affiliate"),
    generatedCustomers: countStage("generated_customer"),
  };

  const spend = monthlySpendUsd();
  const budget = env.OPENAI_MONTHLY_BUDGET_USD;
  const pacing = checkBrowserPacing();

  return {
    pause: getPauseState(),
    config,
    configHasPlaceholders: hasPlaceholders(config),
    totals,
    funnels,
    channelCounts,
    pacing: {
      sentToday: pacing.sentToday,
      dailyLimit: pacing.dailyLimit,
      maxPerDay: env.MAX_DMS_PER_DAY,
      withinHours: pacing.reason !== "outside_operating_hours",
    },
    budget: { spend, budget, pct: budget > 0 ? (spend / budget) * 100 : 0 },
    cost: {
      perLead: totals.leads > 0 ? spend / totals.leads : 0,
      perActiveCustomer: activeCustomers > 0 ? spend / activeCustomers : 0,
    },
    openExceptions: countOpenExceptions(),
    jobs: jobCountsByStatus(),
  };
}

/** Unused var guard: keep the aiCall count available for future panels. */
export function debugAiCallCount(): number {
  return getDb().select().from(aiCalls).all().length;
}
