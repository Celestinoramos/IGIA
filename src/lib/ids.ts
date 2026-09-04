import { randomUUID, randomBytes } from "node:crypto";

/** Prefixed, sortable-enough identifiers for domain entities and jobs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Short opaque token, e.g. for idempotency or dedupe keys. */
export function shortToken(bytes = 8): string {
  return randomBytes(bytes).toString("hex");
}
