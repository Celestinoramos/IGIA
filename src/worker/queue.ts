import "server-only";
import { and, asc, desc, eq, isNotNull, lte, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs, type Job } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowMs } from "@/lib/time";
import { logger } from "@/lib/logger";
import { openException } from "@/features/exceptions/repo";

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: number;
  maxAttempts?: number;
  priority?: number;
  /** When set, the same logical job is enqueued at most once. */
  dedupeKey?: string;
}

/** Enqueue a durable job. Idempotent when `dedupeKey` is provided. */
export function enqueue(input: EnqueueInput): Job | null {
  const db = getDb();
  const job = db
    .insert(jobs)
    .values({
      id: newId("job"),
      type: input.type,
      payload: input.payload ?? {},
      status: "pending",
      priority: input.priority ?? 0,
      runAt: input.runAt ?? nowMs(),
      maxAttempts: input.maxAttempts ?? 5,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning()
    .get();
  return job ?? null;
}

const STUCK_MS = 60_000;

/**
 * Atomically claim the next runnable job. Uses a transaction so two workers (or
 * a restarted worker) can never claim the same row.
 */
export function claimNextJob(workerId: string): Job | null {
  const db = getDb();
  return db.transaction((tx) => {
    const now = nowMs();
    const candidate = tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)))
      .orderBy(desc(jobs.priority), asc(jobs.runAt))
      .get();
    if (!candidate) return null;
    const claimed = tx
      .update(jobs)
      .set({ status: "running", lockedAt: now, lockedBy: workerId, attempts: candidate.attempts + 1, updatedAt: now })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "pending")))
      .returning()
      .get();
    return claimed ?? null;
  });
}

export function completeJob(id: string): void {
  getDb().update(jobs).set({ status: "succeeded", lockedAt: null, lockedBy: null, updatedAt: nowMs() }).where(eq(jobs.id, id)).run();
}

/** Retry with exponential backoff; dead-letter after maxAttempts. */
export function failJob(job: Job, error: string): void {
  const db = getDb();
  if (job.attempts >= job.maxAttempts) {
    db.update(jobs).set({ status: "dead", lastError: error, lockedAt: null, lockedBy: null, updatedAt: nowMs() }).where(eq(jobs.id, job.id)).run();
    openException({
      leadId: (job.payload.leadId as string | undefined) ?? null,
      type: "job_dead_letter",
      reason: error,
      data: { jobType: job.type, jobId: job.id, attempts: job.attempts },
    });
    logger.error("Job dead-lettered", { jobId: job.id, type: job.type, error });
    return;
  }
  const backoff = Math.min(2 ** job.attempts, 32) * 1000;
  db.update(jobs)
    .set({ status: "pending", lastError: error, runAt: nowMs() + backoff, lockedAt: null, lockedBy: null, updatedAt: nowMs() })
    .where(eq(jobs.id, job.id))
    .run();
  logger.warn("Job failed; scheduled retry", { jobId: job.id, type: job.type, attempts: job.attempts, backoffMs: backoff });
}

/**
 * Recover jobs left "running" by a crashed worker: any lock older than STUCK_MS
 * is returned to pending. Called on worker startup and periodically.
 */
export function recoverStuckJobs(): number {
  const db = getDb();
  const cutoff = nowMs() - STUCK_MS;
  const stuck = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "running"), isNotNull(jobs.lockedAt), lte(jobs.lockedAt, cutoff)))
    .all();
  for (const job of stuck) {
    db.update(jobs).set({ status: "pending", lockedAt: null, lockedBy: null, updatedAt: nowMs() }).where(eq(jobs.id, job.id)).run();
  }
  if (stuck.length > 0) logger.warn("Recovered stuck jobs after restart", { count: stuck.length });
  return stuck.length;
}

export function listJobs(limit = 100): Job[] {
  return getDb().select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(limit).all();
}

export function jobCountsByStatus(): Record<string, number> {
  const rows = getDb().select().from(jobs).all();
  const counts: Record<string, number> = { pending: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
  for (const j of rows) counts[j.status] = (counts[j.status] ?? 0) + 1;
  return counts;
}

// Re-export a filtered helper used by the scheduler to avoid duplicate enqueues.
export function hasPendingJobOfType(type: string): boolean {
  const row = getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, type), or(eq(jobs.status, "pending"), eq(jobs.status, "running"))))
    .get();
  return Boolean(row);
}
