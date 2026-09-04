import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { blocklist, leads, type Lead, type NewLead } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowMs } from "@/lib/time";
import { recordAudit, recordEvent } from "@/lib/observability";
import { transitionLead } from "./state-machine";
import type { Funnel, PipelineState } from "./states";

/** Canonical handle: lowercase, no leading @, trimmed. Basis for dedupe. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

export function isBlocked(handle: string): boolean {
  const row = getDb()
    .select()
    .from(blocklist)
    .where(eq(blocklist.instagramHandle, normalizeHandle(handle)))
    .get();
  return Boolean(row);
}

export function addToBlocklist(handle: string, reason: string): void {
  getDb()
    .insert(blocklist)
    .values({ instagramHandle: normalizeHandle(handle), reason })
    .onConflictDoNothing()
    .run();
}

export interface DiscoveredLeadInput {
  funnel: Funnel;
  instagramHandle: string;
  displayName?: string | null;
  bio?: string | null;
  category?: string | null;
  followerCount?: number | null;
  location?: string | null;
  source?: string | null;
  keyword?: string | null;
  niche?: string | null;
  icpScore?: number;
  priority?: number;
  profileType?: Lead["profileType"];
  publicSignals?: Record<string, unknown> | null;
}

export interface UpsertResult {
  created: boolean;
  skipped: boolean;
  lead: Lead | null;
}

/**
 * Insert a discovered lead, deduping by handle and honouring the blocklist.
 * Returns `skipped` when the handle is on the permanent do-not-contact list,
 * `created:false` when the lead already exists (idempotent discovery).
 */
export function upsertDiscoveredLead(input: DiscoveredLeadInput): UpsertResult {
  const handle = normalizeHandle(input.instagramHandle);
  if (isBlocked(handle)) {
    recordEvent({ type: "lead.discovery_skipped_blocked", data: { handle } });
    return { created: false, skipped: true, lead: null };
  }
  const db = getDb();
  const existing = db.select().from(leads).where(eq(leads.instagramHandle, handle)).get();
  if (existing) {
    return { created: false, skipped: false, lead: existing };
  }
  const values: NewLead = {
    id: newId("lead"),
    funnel: input.funnel,
    instagramHandle: handle,
    displayName: input.displayName ?? null,
    bio: input.bio ?? null,
    category: input.category ?? null,
    followerCount: input.followerCount ?? null,
    location: input.location ?? null,
    source: input.source ?? null,
    keyword: input.keyword ?? null,
    niche: input.niche ?? null,
    icpScore: input.icpScore ?? 0,
    priority: input.priority ?? 0,
    profileType: input.profileType ?? "unknown",
    publicSignals: input.publicSignals ?? null,
    pipelineState: "discovered",
    channelState: "browser_contact_pending",
  };
  const created = db.insert(leads).values(values).onConflictDoNothing().returning().get();
  if (!created) {
    // Lost a race; fetch the winner.
    const winner = db.select().from(leads).where(eq(leads.instagramHandle, handle)).get() ?? null;
    return { created: false, skipped: false, lead: winner };
  }
  recordEvent({
    type: "lead.discovered",
    leadId: created.id,
    data: { funnel: created.funnel, source: created.source, keyword: created.keyword, score: created.icpScore },
  });
  recordAudit({ actor: "system", action: "lead.discovered", entity: "lead", entityId: created.id });
  return { created: true, skipped: false, lead: created };
}

export function getLead(id: string): Lead | null {
  return getDb().select().from(leads).where(eq(leads.id, id)).get() ?? null;
}

export function getLeadByHandle(handle: string): Lead | null {
  return (
    getDb().select().from(leads).where(eq(leads.instagramHandle, normalizeHandle(handle))).get() ??
    null
  );
}

export function getLeadByMetaThread(threadId: string): Lead | null {
  return getDb().select().from(leads).where(eq(leads.metaThreadId, threadId)).get() ?? null;
}

export function listLeads(funnel?: Funnel): Lead[] {
  const db = getDb();
  const query = funnel
    ? db.select().from(leads).where(eq(leads.funnel, funnel))
    : db.select().from(leads);
  return query.orderBy(desc(leads.priority), desc(leads.updatedAt)).all();
}

export function listLeadsByPipeline(funnel: Funnel): Record<PipelineState, Lead[]> {
  const rows = listLeads(funnel);
  const grouped: Record<string, Lead[]> = {};
  for (const lead of rows) {
    (grouped[lead.pipelineState] ??= []).push(lead);
  }
  return grouped as Record<PipelineState, Lead[]>;
}

export function updateLeadFields(
  id: string,
  patch: Partial<Pick<Lead, "displayName" | "bio" | "category" | "followerCount" | "location" | "niche" | "icpScore" | "priority" | "profileType" | "tags" | "publicSignals" | "nextActionAt">>,
): void {
  getDb().update(leads).set({ ...patch, updatedAt: nowMs() }).where(eq(leads.id, id)).run();
}

/**
 * Permanent opt-out: freeze the channel on do_not_contact, close the pipeline,
 * and add the handle to the blocklist so no future campaign can re-enter.
 */
export function optOutLead(leadId: string, reason: string): void {
  const lead = getLead(leadId);
  if (!lead) return;
  addToBlocklist(lead.instagramHandle, reason);
  transitionLead({ leadId, channel: "do_not_contact", pipeline: "closed", actor: "system", reason });
  recordEvent({ type: "lead.opt_out", leadId, data: { reason } });
}

/**
 * Match an inbound webhook (identified by the sender's IG-scoped id) to a lead.
 * First by a previously bound instagramUserId; otherwise the oldest lead still
 * waiting for a reply gets bound to this id. Production deployments can resolve
 * the username via the Conversations API for an exact match.
 */
export function matchLeadForInbound(senderId: string): Lead | null {
  const db = getDb();
  const byId = db.select().from(leads).where(eq(leads.instagramUserId, senderId)).get();
  if (byId) return byId;
  const waiting = db
    .select()
    .from(leads)
    .where(and(eq(leads.channelState, "waiting_inbound_reply")))
    .orderBy(leads.lastOutboundAt)
    .get();
  return waiting ?? null;
}

export function findLeadsForDiscoveryDedup(handles: string[]): Set<string> {
  const normalized = handles.map(normalizeHandle);
  const found = new Set<string>();
  for (const handle of normalized) {
    if (getLeadByHandle(handle) || isBlocked(handle)) found.add(handle);
  }
  return found;
}
