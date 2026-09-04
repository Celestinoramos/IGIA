import type { BusinessConfig } from "@/config/business";

/**
 * The AI may only send what is in `verifiedClaims`. This guard rejects drafts
 * that echo an unverified claim or that fabricate rates, guarantees, superlatives
 * or account-approval / financial-result promises. It is intentionally strict:
 * on any doubt the draft is blocked and the flow escalates or uses a safe template.
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Forbidden patterns: superlatives, guarantees, invented rates, approval/result promises.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bgarant/, label: "guarantee" },
  { pattern: /aprovacao garantida|aprovacao na hora|conta aprovada/, label: "account_approval_promise" },
  { pattern: /melhor (taxa|do mercado|preco)|menor taxa|imbativel|numero 1|n[º°]?\s*1|lider de mercado/, label: "superlative" },
  { pattern: /\b100%\b|\bsem risco\b|\bzero risco\b/, label: "absolute_claim" },
  { pattern: /lucro garantido|retorno garantido|ganho garantido|resultado garantido/, label: "financial_result_promise" },
  { pattern: /\btaxa de \d/, label: "specific_rate" },
  { pattern: /socio|participacao societaria/, label: "ownership_relationship" },
];

export interface ClaimCheck {
  ok: boolean;
  violations: string[];
}

export function checkClaims(message: string, config: BusinessConfig): ClaimCheck {
  const normalized = normalize(message);
  const violations: string[] = [];

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) violations.push(label);
  }

  // Block if the draft paraphrases a known unverified claim (token overlap).
  for (const claim of config.claims.unverified) {
    const claimTokens = normalize(claim)
      .split(/\W+/)
      .filter((t) => t.length > 3);
    if (claimTokens.length === 0) continue;
    const overlap = claimTokens.filter((t) => normalized.includes(t)).length / claimTokens.length;
    if (overlap >= 0.6) violations.push(`unverified_claim:${claim.slice(0, 40)}`);
  }

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}
