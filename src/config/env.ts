import { z } from "zod";

/**
 * Environment validation. Runtime credentials and operational limits live in
 * `.env`; nothing here has a real business value baked in. Missing optional
 * integrations degrade gracefully (mock OpenAI, simulated browser) rather than
 * crashing, so work that does not need a credential keeps flowing.
 */

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Database
  DATABASE_URL: z.string().default("file:./data/app.db"),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  OPENAI_MODEL_FAST: z.string().default("gpt-4o-mini"),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(50),

  // Browser (Playwright over CDP)
  CHROME_CDP_URL: z.string().optional(),
  CHROME_PROFILE_DIR: z.string().optional(),
  BROWSER_DRIVER: z.enum(["real", "simulated"]).default("simulated"),
  DRY_RUN: booleanish.default("true"),

  // Meta Instagram official API + webhook
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_PAGE_ACCESS_TOKEN: z.string().optional(),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional(),
  INSTAGRAM_GRAPH_API_BASE: z.string().default("https://graph.instagram.com/v23.0"),

  // Rate limiting / human pacing
  MAX_DMS_PER_DAY: z.coerce.number().int().positive().default(30),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(240),
  OPERATING_HOURS: z.string().default("09:00-20:00"),
  OPERATING_TIMEZONE: z.string().default("America/Sao_Paulo"),

  // Encryption for persisted browser session/state at rest
  STATE_ENCRYPTION_KEY: z.string().optional(),

  // Worker pacing (kept short in sandbox/tests so simulations run fast)
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1500),
  PACING_TIME_SCALE: z.coerce.number().nonnegative().default(1),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  if (env.MIN_SECONDS_BETWEEN_DMS > env.MAX_SECONDS_BETWEEN_DMS) {
    throw new Error(
      "MIN_SECONDS_BETWEEN_DMS must be <= MAX_SECONDS_BETWEEN_DMS",
    );
  }
  cached = env;
  return env;
}

/** Test helper: reset the cache after mutating process.env. */
export function resetEnvCache(): void {
  cached = null;
}
