import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";
import { getEnv } from "@/config/env";

export type DB = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let db: DB | null = null;

function resolveSqlitePath(): string {
  const url = getEnv().DATABASE_URL;
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return resolve(process.cwd(), raw);
}

/**
 * Open the shared SQLite connection with the reliability pragmas the spec
 * requires: WAL for concurrent panel+worker reads, foreign keys on, a busy
 * timeout so writers wait instead of failing.
 */
export function getDb(): DB {
  if (db) return db;
  const path = resolveSqlitePath();
  mkdirSync(dirname(path), { recursive: true });
  sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  db = drizzle(sqlite, { schema });
  return db;
}

export function getRawSqlite(): Database.Database {
  getDb();
  if (!sqlite) throw new Error("SQLite not initialised");
  return sqlite;
}

/** Close the connection cleanly. Prevents native teardown asserts on exit. */
export function closeDb(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

export { schema };
