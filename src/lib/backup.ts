import "server-only";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { getRawSqlite } from "@/db/client";
import { nowMs } from "./time";
import { logger } from "./logger";
import { recordAudit } from "./observability";

const BACKUP_DIR = "backups";
const MAX_BACKUPS = 14;

/**
 * Consistent online backup using SQLite's VACUUM INTO. Works with WAL and does
 * not block writers. Retains the most recent MAX_BACKUPS files.
 * Restore: stop the app, replace data/app.db with a backup file, restart.
 */
export function backupDatabase(): string {
  const dir = resolve(process.cwd(), BACKUP_DIR);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(nowMs()).toISOString().replace(/[:.]/g, "-");
  const target = resolve(dir, `app-${stamp}.db`);
  const sqlite = getRawSqlite();
  sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  pruneOldBackups(dir);
  recordAudit({ actor: "system", action: "db.backup", data: { target } });
  logger.info("Database backup created", { target });
  return target;
}

function pruneOldBackups(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("app-") && f.endsWith(".db"))
    .map((f) => ({ f, mtime: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { f } of files.slice(MAX_BACKUPS)) {
    unlinkSync(resolve(dir, f));
  }
}
