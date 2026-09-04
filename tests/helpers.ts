import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

let counter = 0;

const TEST_BUSINESS_CONFIG = {
  owner: { name: "Test Owner", role: "CEO" },
  company: {
    name: "Test Company",
    website: "https://example.com",
    instagramHandle: "@testcompany",
  },
  links: {
    whatsapp: "https://wa.me/5511999999999",
    affiliateGroup: "https://chat.whatsapp.com/test123",
  },
  offer: {
    oneLinePitch: "Test pitch",
    howItWorks: ["Step 1", "Step 2"],
    revenueModel: "Subscription",
    jargon: [{ term: "test", meaning: "test definition" }],
  },
  claims: {
    verified: ["Plataforma testada e validada por centenas de lojistas"],
    unverified: ["Aprovacao garantida em 24 horas"],
  },
  icp: {
    segments: ["loja", "dono"],
    keywords: ["moda", "fitness"],
  },
  affiliates: { topics: ["fashion", "wellness"] },
  geography: "BR",
};

/**
 * Reset to a clean, isolated SQLite database for a test. Sets safe defaults
 * (simulated browser, mock AI, 24h operating window) and applies migrations.
 * Writes a valid test business.json so Zod validation passes in all tests.
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

  // Point the business-config loader at a dedicated test fixture so tests never
  // overwrite the operator's real config/business.json.
  const fixturePath = "tests/fixtures/business.json";
  mkdirSync(resolve(process.cwd(), "tests/fixtures"), { recursive: true });
  writeFileSync(resolve(process.cwd(), fixturePath), JSON.stringify(TEST_BUSINESS_CONFIG, null, 2));
  process.env.BUSINESS_CONFIG_PATH = fixturePath;
  const { resetBusinessConfigCache } = await import("@/config/business");
  resetBusinessConfigCache();

  const { runMigrations } = await import("@/db/migrate");
  runMigrations();
}
