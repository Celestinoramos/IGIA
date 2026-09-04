import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";

describe("durable jobs, retries & crash recovery", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("enqueues idempotently by dedupeKey", async () => {
    const { enqueue } = await import("@/worker/queue");
    const a = enqueue({ type: "backup_db", dedupeKey: "same" });
    const b = enqueue({ type: "backup_db", dedupeKey: "same" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("claims a job atomically and increments attempts", async () => {
    const { enqueue, claimNextJob } = await import("@/worker/queue");
    enqueue({ type: "backup_db" });
    const first = claimNextJob("w1");
    const second = claimNextJob("w2");
    expect(first).not.toBeNull();
    expect(first?.attempts).toBe(1);
    expect(second).toBeNull(); // already claimed
  });

  it("retries with backoff then dead-letters", async () => {
    const { enqueue, claimNextJob, failJob } = await import("@/worker/queue");
    const { getDb } = await import("@/db/client");
    const { jobs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const job = enqueue({ type: "x", maxAttempts: 1 })!;
    const claimed = claimNextJob("w1")!;
    failJob(claimed, "boom");
    const row = getDb().select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.status).toBe("dead");
    const { countOpenExceptions } = await import("@/features/exceptions/repo");
    expect(countOpenExceptions()).toBeGreaterThan(0);
  });

  it("recovers jobs stuck by a crashed worker", async () => {
    const { enqueue, recoverStuckJobs } = await import("@/worker/queue");
    const { getDb } = await import("@/db/client");
    const { jobs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const job = enqueue({ type: "backup_db" })!;
    getDb().update(jobs).set({ status: "running", lockedAt: Date.now() - 120_000, lockedBy: "dead" }).where(eq(jobs.id, job.id)).run();
    const recovered = recoverStuckJobs();
    expect(recovered).toBe(1);
    expect(getDb().select().from(jobs).where(eq(jobs.id, job.id)).get()!.status).toBe("pending");
  });
});
