import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { getEnv } from "@/config/env";

/**
 * AES-256-GCM helpers for encrypting sensitive state at rest (e.g. persisted
 * browser session data). The key is derived from STATE_ENCRYPTION_KEY.
 */
function key(): Buffer {
  const secret = getEnv().STATE_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error("STATE_ENCRYPTION_KEY must be set (>=16 chars) to encrypt state at rest.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptString(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
