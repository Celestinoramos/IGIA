import { loadDotEnv } from "@/lib/dotenv";

loadDotEnv();

async function main(): Promise<void> {
  const { backupDatabase } = await import("@/lib/backup");
  const { closeDb } = await import("@/db/client");
  const path = backupDatabase();
  console.log(`Backup created at ${path}`);
  closeDb();
}

main().catch((error) => {
  console.error("Backup failed:", error);
  process.exitCode = 1;
});
