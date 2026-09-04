import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load `.env` into process.env for standalone processes (worker, scripts,
 * tests). Next.js loads env files itself, so this is a no-op there. Uses the
 * built-in Node loader (Node 20.6+) and never overrides already-set vars.
 */
export function loadDotEnv(file = ".env"): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // If already loaded or unsupported, silently continue with process.env.
  }
}
