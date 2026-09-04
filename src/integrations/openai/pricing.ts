/**
 * Approximate USD pricing per 1M tokens. Used for budget accounting and the
 * cost-per-lead / cost-per-customer panel metrics. Unknown models fall back to
 * a conservative estimate so spend is never silently under-counted.
 */
interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
};

const FALLBACK: ModelPrice = { inputPerMillion: 2.5, outputPerMillion: 10 };

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICES[model] ?? FALLBACK;
  const input = (promptTokens / 1_000_000) * price.inputPerMillion;
  const output = (completionTokens / 1_000_000) * price.outputPerMillion;
  return Number((input + output).toFixed(6));
}

/** Rough token estimate for the mock engine (≈4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
