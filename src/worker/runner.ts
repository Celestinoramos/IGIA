import "server-only";
import { getEnv } from "@/config/env";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { isPaused } from "@/lib/system-state";
import { claimNextJob, completeJob, failJob, recoverStuckJobs } from "./queue";
import { getHandler } from "./handlers";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runJobOnce(workerId: string): Promise<boolean> {
  const job = claimNextJob(workerId);
  if (!job) return false;
  const handler = getHandler(job.type);
  if (!handler) {
    failJob(job, `no handler for job type "${job.type}"`);
    return true;
  }
  try {
    await handler(job.payload, job);
    completeJob(job.id);
  } catch (error) {
    failJob(job, error instanceof Error ? error.message : String(error));
  }
  return true;
}

/**
 * Drain runnable jobs synchronously until the queue is empty or a limit is hit.
 * Used by the demo and tests to advance the system deterministically without
 * waiting on the poll interval. Skips work while the system is paused.
 */
export async function drainQueue(maxJobs = 500): Promise<number> {
  const workerId = newId("drain");
  recoverStuckJobs();
  let processed = 0;
  while (processed < maxJobs) {
    if (isPaused()) break;
    const didWork = await runJobOnce(workerId);
    if (!didWork) break;
    processed += 1;
  }
  return processed;
}

/** Long-running worker loop with graceful shutdown. */
export async function runWorkerLoop(signal: { stopped: boolean }): Promise<void> {
  const env = getEnv();
  const workerId = newId("worker");
  logger.info("Worker started", { workerId, driver: env.BROWSER_DRIVER, dryRun: env.DRY_RUN });
  recoverStuckJobs();

  let sinceRecovery = 0;
  while (!signal.stopped) {
    if (isPaused()) {
      await sleep(env.WORKER_POLL_INTERVAL_MS);
      continue;
    }
    const didWork = await runJobOnce(workerId);
    if (!didWork) {
      await sleep(env.WORKER_POLL_INTERVAL_MS);
    }
    // Periodically recover jobs stuck by a crash elsewhere.
    sinceRecovery += 1;
    if (sinceRecovery > 50) {
      recoverStuckJobs();
      sinceRecovery = 0;
    }
  }
  logger.info("Worker stopped", { workerId });
}
