import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Business identity, offer, ICP and — critically — claims. This is the ONLY
 * place real business data may live. Every message and decision reads from
 * here; nothing is hard-coded elsewhere in the system.
 *
 * `verifiedClaims` are the only statements the AI may ever send.
 * `unverifiedClaims` are blocked until an operator moves them into verified.
 */

const jargonSchema = z.object({
  term: z.string().min(1),
  meaning: z.string().min(1),
});

export const businessConfigSchema = z.object({
  owner: z.object({
    name: z.string().min(1),
    role: z.string().min(1),
  }),
  company: z.object({
    name: z.string().min(1),
    website: z.string().url(),
    instagramHandle: z.string().min(1),
  }),
  links: z.object({
    whatsapp: z.string().url(),
    affiliateGroup: z.string().url(),
  }),
  offer: z.object({
    oneLinePitch: z.string().min(1),
    howItWorks: z.array(z.string().min(1)).min(1),
    revenueModel: z.string().min(1),
    jargon: z.array(jargonSchema).default([]),
  }),
  claims: z.object({
    verified: z.array(z.string().min(1)),
    unverified: z.array(z.string().min(1)).default([]),
  }),
  icp: z.object({
    segments: z.array(z.string().min(1)).min(1),
    keywords: z.array(z.string().min(1)).min(1),
  }),
  affiliates: z.object({
    topics: z.array(z.string().min(1)).min(1),
  }),
  geography: z.string().min(1),
});

export type BusinessConfig = z.infer<typeof businessConfigSchema>;

function configPath(): string {
  return resolve(process.cwd(), "config", "business.json");
}

let cached: BusinessConfig | null = null;

export function loadBusinessConfig(): BusinessConfig {
  if (cached) return cached;
  const path = configPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Missing config/business.json. Copy config/business.example.json and fill it in. (looked at ${path})`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config/business.json is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = businessConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config/business.json: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Detects unreplaced `{{PLACEHOLDER}}` values so the panel can warn operators. */
export function hasPlaceholders(config: BusinessConfig): boolean {
  return JSON.stringify(config).includes("{{");
}

export function resetBusinessConfigCache(): void {
  cached = null;
}
