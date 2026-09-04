import { toIso, nowMs } from "./time";

type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = [
  "token",
  "secret",
  "password",
  "authorization",
  "apikey",
  "api_key",
  "access_token",
  "page_access_token",
  "app_secret",
  "verify_token",
  "openai_api_key",
];

/**
 * Redact values whose key looks sensitive, at any depth. Structured logs must
 * never leak credentials, so redaction happens before serialisation.
 */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      out[key] = SENSITIVE_KEYS.some((s) => lower.includes(s))
        ? "[REDACTED]"
        : redact(val);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const line = {
    ts: toIso(nowMs()),
    level,
    message,
    ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    process.env.LOG_LEVEL === "debug" ? emit("debug", message, context) : undefined,
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
