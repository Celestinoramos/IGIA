import "server-only";
import { loadBusinessConfig } from "@/config/business";
import { recordEvent } from "@/lib/observability";
import { upsertDiscoveredLead, updateLeadFields } from "@/features/leads/repo";
import { transitionLead } from "@/features/leads/state-machine";
import { scoreLead, type PublicProfile } from "@/features/leads/scoring";
import type { Funnel } from "@/features/leads/states";
import { enqueue } from "@/worker/queue";

const QUALIFY_THRESHOLD = 25;

export interface DiscoveryResult {
  discovered: number;
  duplicates: number;
  blocked: number;
  qualified: number;
}

/**
 * Discover candidate profiles for a funnel: dedupe against existing leads and
 * the blocklist, score against the ICP, and qualify high-scoring leads for
 * first contact. In production `candidates` come from public Instagram signals;
 * in the sandbox they are supplied by the seed/demo scripts.
 */
export function discoverLeads(funnel: Funnel, candidates: PublicProfile[]): DiscoveryResult {
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
      source: "discovery",
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
    if (score.score >= QUALIFY_THRESHOLD && upsert.lead) {
      transitionLead({ leadId: upsert.lead.id, pipeline: "qualified", actor: "system", reason: "icp_qualified" });
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

  recordEvent({ type: "campaign.discovery_run", data: { funnel, ...result } });
  return result;
}
