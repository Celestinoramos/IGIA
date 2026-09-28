import { loadDotEnv } from "@/lib/dotenv";

loadDotEnv();

async function main(): Promise<void> {
  // Import after env is loaded so config reads the right values.
  const { runMigrations } = await import("@/db/migrate");
  const { runWorkerLoop } = await import("./runner");
  const { logger } = await import("@/lib/logger");
  const { enqueue, hasPendingJobOfType } = await import("./queue");
  const { requeueStrandedFirstContacts } = await import("@/features/campaigns/first-contact");

  runMigrations();

  // Ensure a daily backup job exists.
  if (!hasPendingJobOfType("backup_db")) {
    enqueue({ type: "backup_db", dedupeKey: `backup_db:${new Date().toISOString().slice(0, 10)}` });
  }

  const requeued = requeueStrandedFirstContacts();
  if (requeued > 0) logger.info("Re-enqueued stranded first contacts", { count: requeued });

  const signal = { stopped: false };
  const shutdown = (sig: string) => {
    logger.info("Received shutdown signal", { sig });
    signal.stopped = true;
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await runWorkerLoop(signal);
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "error", message: "Worker crashed", error: String(error) }));
  process.exit(1);
});
