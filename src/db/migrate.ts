import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadDotEnv } from "@/lib/dotenv";
import { logger } from "@/lib/logger";
import { getDb } from "./client";

/** Applies versioned SQL migrations from ./drizzle. Safe to run repeatedly. */
export function runMigrations(): void {
  const folder = resolve(process.cwd(), "drizzle");
  if (!existsSync(folder)) {
    logger.warn("No drizzle/ folder found; run `pnpm db:generate` first.");
    return;
  }
  migrate(getDb(), { migrationsFolder: folder });
  logger.info("Database migrations applied.");
}

// Allow `tsx src/db/migrate.ts` to run migrations directly.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).endsWith("migrate.ts");
if (invokedDirectly) {
  loadDotEnv();
  runMigrations();
}
