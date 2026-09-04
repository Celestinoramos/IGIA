import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  Funnel,
  PipelineState,
  ChannelState,
  ProfileType,
} from "@/features/leads/states";

const createdAt = () =>
  integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/** Leads. `instagramHandle` is unique to prevent duplicates at the source. */
export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    funnel: text("funnel").$type<Funnel>().notNull(),
    instagramHandle: text("instagram_handle").notNull(),
    instagramUserId: text("instagram_user_id"),
    displayName: text("display_name"),
    bio: text("bio"),
    category: text("category"),
    followerCount: integer("follower_count"),
    location: text("location"),
    profileType: text("profile_type").$type<ProfileType>().notNull().default("unknown"),
    niche: text("niche"),
    source: text("source"),
    keyword: text("keyword"),
    icpScore: real("icp_score").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    pipelineState: text("pipeline_state").$type<PipelineState>().notNull().default("discovered"),
    channelState: text("channel_state").$type<ChannelState>().notNull().default("browser_contact_pending"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // Signals extracted from public profile content, kept for the AI context.
    publicSignals: text("public_signals", { mode: "json" }).$type<Record<string, unknown>>(),
    // Meta thread/conversation id, matched on inbound webhook to hand off.
    metaThreadId: text("meta_thread_id"),
    lastInboundAt: integer("last_inbound_at"),
    lastOutboundAt: integer("last_outbound_at"),
    nextActionAt: integer("next_action_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("leads_handle_unique").on(t.instagramHandle),
    uniqueIndex("leads_meta_thread_unique").on(t.metaThreadId),
    index("leads_pipeline_idx").on(t.funnel, t.pipelineState),
    index("leads_channel_idx").on(t.channelState),
    index("leads_next_action_idx").on(t.nextActionAt),
  ],
);

/** Messages. `externalId` (Meta mid) is unique for webhook idempotency. */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    direction: text("direction").$type<"outbound" | "inbound">().notNull(),
    channel: text("channel").$type<"browser" | "api" | "system">().notNull(),
    body: text("body").notNull(),
    variantId: text("variant_id"),
    intent: text("intent"),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_external_id_unique").on(t.externalId),
    index("messages_lead_idx").on(t.leadId, t.createdAt),
  ],
);

/** Durable job queue (replaces Redis for the MVP). */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    status: text("status")
      .$type<"pending" | "running" | "succeeded" | "failed" | "dead">()
      .notNull()
      .default("pending"),
    priority: integer("priority").notNull().default(0),
    runAt: integer("run_at").notNull().default(sql`(unixepoch() * 1000)`),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    // Optional idempotency/dedupe key so the same logical job is enqueued once.
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_dedupe_unique").on(t.dedupeKey),
    index("jobs_claim_idx").on(t.status, t.runAt, t.priority),
  ],
);

/** Every OpenAI call: model, tokens, estimated cost. Drives budget + ROI. */
export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    mock: integer("mock", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt)],
);

/** Structured events for optimization/attribution analysis. */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [index("events_type_idx").on(t.type, t.createdAt)],
);

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  variable: text("variable").notNull(),
  status: text("status").$type<"running" | "paused" | "completed">().notNull().default("running"),
  minSampleSize: integer("min_sample_size").notNull().default(30),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const experimentVariants = sqliteTable(
  "experiment_variants",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    description: text("description"),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    weight: real("weight").notNull().default(1),
    isControl: integer("is_control", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("variant_experiment_key_unique").on(t.experimentId, t.key)],
);

export const experimentAssignments = sqliteTable(
  "experiment_assignments",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => experimentVariants.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("assignment_experiment_lead_unique").on(t.experimentId, t.leadId)],
);

/** Exceptions queue: things that need a human or a safe re-try. */
export const exceptions = sqliteTable(
  "exceptions",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    reason: text("reason").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    status: text("status").$type<"open" | "resolved">().notNull().default("open"),
    createdAt: createdAt(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("exceptions_status_idx").on(t.status, t.createdAt)],
);

/** Immutable audit log of who did what (ai / system / operator). */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actor: text("actor").$type<"ai" | "system" | "operator">().notNull(),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);

/** Webhook idempotency ledger keyed by Meta event id. */
export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  processedAt: integer("processed_at"),
  createdAt: createdAt(),
});

/** Per-day counters for warmup + daily DM caps. */
export const dailyCounters = sqliteTable("daily_counters", {
  dateKey: text("date_key").primaryKey(),
  dmsSent: integer("dms_sent").notNull().default(0),
});

/**
 * Permanent do-not-contact list keyed by handle. Survives lead deletion and
 * blocks re-entry across ALL campaigns and channels.
 */
export const blocklist = sqliteTable("blocklist", {
  instagramHandle: text("instagram_handle").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

/** Single-row key/value system settings (pause switch, circuit state, etc.). */
export const systemState = sqliteTable("system_state", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type AiCall = typeof aiCalls.$inferSelect;
export type Experiment = typeof experiments.$inferSelect;
export type ExperimentVariant = typeof experimentVariants.$inferSelect;
export type ExceptionRow = typeof exceptions.$inferSelect;
export type EventRow = typeof events.$inferSelect;
