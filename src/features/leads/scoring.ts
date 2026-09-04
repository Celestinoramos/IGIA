import type { BusinessConfig } from "@/config/business";
import type { Funnel, ProfileType } from "./states";

export interface PublicProfile {
  instagramHandle: string;
  displayName?: string | null;
  bio?: string | null;
  category?: string | null;
  followerCount?: number | null;
  location?: string | null;
  hashtags?: string[];
}

export interface ScoreResult {
  score: number;
  priority: number;
  profileType: ProfileType;
  matchedKeywords: string[];
  niche: string | null;
}

const OWNER_HINTS = ["dono", "dona", "fundador", "fundadora", "ceo", "proprietári", "sócio", "socia"];
const DECISION_HINTS = ["gerente", "diretor", "diretora", "responsável", "gestor", "gestora"];
const STORE_HINTS = ["loja", "store", "atacado", "varejo", "cnpj", "pedidos", "delivery", "peça já", "faça seu pedido"];
const EMPLOYEE_HINTS = ["vendedor", "vendedora", "atendente", "colaborador"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Deterministic ICP scoring from public signals. The AI can later refine the
 * profile type, but scoring itself is auditable and reproducible.
 */
export function scoreLead(
  profile: PublicProfile,
  funnel: Funnel,
  config: BusinessConfig,
): ScoreResult {
  const haystack = normalize(
    [profile.displayName, profile.bio, profile.category, ...(profile.hashtags ?? [])]
      .filter(Boolean)
      .join(" "),
  );

  const keywords = funnel === "customer" ? config.icp.keywords : config.affiliates.topics;
  const matchedKeywords = keywords.filter((k) => haystack.includes(normalize(k)));

  const segments = funnel === "customer" ? config.icp.segments : config.affiliates.topics;
  const matchedSegment = segments.find((s) => haystack.includes(normalize(s))) ?? null;

  let score = 0;
  score += matchedKeywords.length * 20;
  if (matchedSegment) score += 25;

  const followers = profile.followerCount ?? 0;
  if (funnel === "customer") {
    // Small/medium businesses convert best.
    if (followers >= 500 && followers <= 50_000) score += 20;
    else if (followers > 50_000) score += 5;
  } else {
    // Affiliates: real engagement range, avoid mega/ghost accounts.
    if (followers >= 3_000 && followers <= 300_000) score += 25;
  }

  const profileType = classifyProfileType(haystack, funnel);
  if (profileType === "owner" || profileType === "decision_maker") score += 20;
  if (profileType === "store") score += 10;

  score = Math.max(0, Math.min(100, score));
  const priority = score >= 70 ? 3 : score >= 45 ? 2 : score >= 25 ? 1 : 0;

  return { score, priority, profileType, matchedKeywords, niche: matchedSegment };
}

export function classifyProfileType(normalizedText: string, funnel: Funnel): ProfileType {
  if (funnel === "affiliate") return "creator";
  if (OWNER_HINTS.some((h) => normalizedText.includes(normalize(h)))) return "owner";
  if (DECISION_HINTS.some((h) => normalizedText.includes(normalize(h)))) return "decision_maker";
  if (EMPLOYEE_HINTS.some((h) => normalizedText.includes(normalize(h)))) return "employee";
  if (STORE_HINTS.some((h) => normalizedText.includes(normalize(h)))) return "store";
  return "unknown";
}
