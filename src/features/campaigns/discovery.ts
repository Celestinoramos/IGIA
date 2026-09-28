import "server-only";
import { loadBusinessConfig } from "@/config/business";
import { recordEvent } from "@/lib/observability";
import { upsertDiscoveredLead, updateLeadFields } from "@/features/leads/repo";
import { transitionLead } from "@/features/leads/state-machine";
import { scoreLead, type PublicProfile } from "@/features/leads/scoring";
import type { Funnel } from "@/features/leads/states";
import { enqueue } from "@/worker/queue";

export const QUALIFY_THRESHOLD = 25;

export interface DiscoveryOptions {
  /** Where the candidates came from, stored on the lead (default "discovery"). */
  source?: string;
  /**
   * Qualify every new lead regardless of ICP score — for lists the operator has
   * already vetted by hand. Blocklist and dedupe still apply.
   */
  qualifyAll?: boolean;
}

export interface DiscoveryResult {
  discovered: number;
  duplicates: number;
  blocked: number;
  qualified: number;
}

/**
 * Discover candidate profiles for a funnel: dedupe against existing leads and
 * the blocklist, score against the ICP, and qualify high-scoring leads for
 * first contact. Candidates come from the operator's lead import in the panel,
 * or from the seed/demo scripts in the sandbox.
 */
export function discoverLeads(funnel: Funnel, candidates: PublicProfile[], options: DiscoveryOptions = {}): DiscoveryResult {
  const config = loadBusinessConfig();
  const result: DiscoveryResult = { discovered: 0, duplicates: 0, blocked: 0, qualified: 0 };

  for (const profile of candidates) {
    const score = scoreLead(profile, funnel, config);
    const upsert = upsertDiscoveredLead({
      funnel,
      instagramHandle: profile.instagramHandle,
      displayName: profile.displayName,
      bio: profile.bio,
      category: profile.category,
      followerCount: profile.followerCount,
      location: profile.location,
      source: options.source ?? "discovery",
      keyword: score.matchedKeywords[0] ?? null,
      niche: score.niche,
      icpScore: score.score,
      priority: score.priority,
      profileType: score.profileType,
      publicSignals: { hashtags: profile.hashtags ?? [], matchedKeywords: score.matchedKeywords },
    });

    if (upsert.skipped) {
      result.blocked += 1;
      continue;
    }
    if (!upsert.created) {
      result.duplicates += 1;
      continue;
    }
    result.discovered += 1;

    // Qualify high-scoring leads and enqueue first contact.
    const qualifies = score.score >= QUALIFY_THRESHOLD || options.qualifyAll === true;
    if (qualifies && upsert.lead) {
      const reason = score.score >= QUALIFY_THRESHOLD ? "icp_qualified" : "operator_vetted";
      transitionLead({ leadId: upsert.lead.id, pipeline: "qualified", actor: "system", reason });
      updateLeadFields(upsert.lead.id, { icpScore: score.score, priority: score.priority });
      enqueue({
        type: "first_contact",
        payload: { leadId: upsert.lead.id },
        dedupeKey: `first_contact:${upsert.lead.id}`,
        priority: score.priority,
      });
      result.qualified += 1;
    }
  }

  recordEvent({ type: "campaign.discovery_run", data: { funnel, source: options.source ?? "discovery", ...result } });
  return result;
}
