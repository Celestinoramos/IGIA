import { rmSync } from "node:fs";
import { resolve } from "node:path";

let counter = 0;

/**
 * Reset to a clean, isolated SQLite database for a test. Sets safe defaults
 * (simulated browser, mock AI, 24h operating window) and applies migrations.
 * Uses dynamic imports so env is set before the DB client reads it.
 */
export async function freshDb(): Promise<void> {
  const { closeDb } = await import("@/db/client");
  closeDb();

  counter += 1;
  const path = `./data/test-${process.pid}-${counter}.db`;
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(resolve(process.cwd(), `${path}${suffix}`), { force: true });
  }

  process.env.DATABASE_URL = `file:${path}`;
  process.env.BROWSER_DRIVER = "simulated";
  process.env.CHROME_CDP_URL = "http://127.0.0.1:9222";
  process.env.DRY_RUN = "true";
  process.env.OPENAI_API_KEY = "";
  process.env.OPERATING_HOURS = "00:00-24:00";
  process.env.MAX_DMS_PER_DAY = "100";
  process.env.MIN_SECONDS_BETWEEN_DMS = "90";
  process.env.MAX_SECONDS_BETWEEN_DMS = "240";
  process.env.PACING_TIME_SCALE = "0";
  process.env.OPENAI_MONTHLY_BUDGET_USD = "50";
  process.env.STATE_ENCRYPTION_KEY = "test_encryption_key_0123456789abcdef";

  const { resetEnvCache } = await import("@/config/env");
  resetEnvCache();
  const { runMigrations } = await import("@/db/migrate");
  runMigrations();
}
