import "server-only";
import { getDb } from "@/db/client";
import { aiCalls } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getEnv } from "@/config/env";
import { localMonthKey, nowMs } from "@/lib/time";
import { pauseSystem } from "@/lib/system-state";
import { recordEvent } from "@/lib/observability";
import { estimateCostUsd } from "./pricing";

/** Sum estimated OpenAI spend for the current month (operator timezone). */
export function monthlySpendUsd(): number {
  const tz = getEnv().OPERATING_TIMEZONE;
  const month = localMonthKey(nowMs(), tz);
  const rows = getDb().select().from(aiCalls).all();
  return rows
    .filter((r) => localMonthKey(r.createdAt, tz) === month)
    .reduce((sum, r) => sum + r.costUsd, 0);
}

export interface BudgetStatus {
  withinBudget: boolean;
  spend: number;
  budget: number;
}

/** Called before every AI call. Pauses the whole system when the cap is hit. */
export function checkBudget(): BudgetStatus {
  const budget = getEnv().OPENAI_MONTHLY_BUDGET_USD;
  const spend = monthlySpendUsd();
  const withinBudget = spend < budget;
  if (!withinBudget) {
    pauseSystem("openai_budget_exceeded", "system");
    recordEvent({ type: "openai.budget_exceeded", data: { spend, budget } });
  }
  return { withinBudget, spend, budget };
}

export function recordAiCall(params: {
  leadId?: string | null;
  purpose: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  mock: boolean;
}): number {
  const costUsd = params.mock
    ? 0
    : estimateCostUsd(params.model, params.promptTokens, params.completionTokens);
  getDb()
    .insert(aiCalls)
    .values({
      id: newId("ai"),
      leadId: params.leadId ?? null,
      purpose: params.purpose,
      model: params.model,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.promptTokens + params.completionTokens,
      costUsd,
      mock: params.mock,
    })
    .run();
  return costUsd;
}
