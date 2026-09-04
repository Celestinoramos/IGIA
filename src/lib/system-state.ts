import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { systemState } from "@/db/schema";
import { nowMs } from "./time";
import { recordAudit } from "./observability";
import { logger } from "./logger";

const PAUSE_KEY = "paused";
const WARMUP_KEY = "warmup_start_ms";

export interface PauseState {
  paused: boolean;
  reason: string | null;
  since: number | null;
}

function readState<T>(key: string): T | null {
  const row = getDb().select().from(systemState).where(eq(systemState.key, key)).get();
  return row ? (row.value as T) : null;
}

function writeState(key: string, value: unknown): void {
  getDb()
    .insert(systemState)
    .values({ key, value, updatedAt: nowMs() })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: nowMs() } })
    .run();
}

export function getPauseState(): PauseState {
  return readState<PauseState>(PAUSE_KEY) ?? { paused: false, reason: null, since: null };
}

export function isPaused(): boolean {
  return getPauseState().paused;
}

/** Global stop. Idempotent: keeps the first reason if already paused. */
export function pauseSystem(reason: string, actor: "system" | "operator" | "ai"): void {
  const current = getPauseState();
  if (current.paused) return;
  writeState(PAUSE_KEY, { paused: true, reason, since: nowMs() } satisfies PauseState);
  recordAudit({ actor, action: "system.pause", data: { reason } });
  logger.warn("System paused", { reason, actor });
}

export function resumeSystem(actor: "operator" | "system"): void {
  writeState(PAUSE_KEY, { paused: false, reason: null, since: null } satisfies PauseState);
  recordAudit({ actor, action: "system.resume" });
  logger.info("System resumed", { actor });
}

/** Warmup schedule anchor: first day of operation, used to cap daily volume. */
export function getWarmupStartMs(): number {
  const existing = readState<number>(WARMUP_KEY);
  if (existing) return existing;
  const now = nowMs();
  writeState(WARMUP_KEY, now);
  return now;
}

// ── Circuit breaker ─────────────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 5 * 60_000;

function circuitKey(name: string): string {
  return `circuit:${name}`;
}

export function recordCircuitFailure(name: string): boolean {
  const state = readState<CircuitState>(circuitKey(name)) ?? { failures: 0, openedAt: null };
  state.failures += 1;
  let opened = false;
  if (state.failures >= CIRCUIT_THRESHOLD && state.openedAt === null) {
    state.openedAt = nowMs();
    opened = true;
  }
  writeState(circuitKey(name), state);
  return opened;
}

export function recordCircuitSuccess(name: string): void {
  writeState(circuitKey(name), { failures: 0, openedAt: null } satisfies CircuitState);
}

export function isCircuitOpen(name: string): boolean {
  const state = readState<CircuitState>(circuitKey(name));
  if (!state || state.openedAt === null) return false;
  if (nowMs() - state.openedAt > CIRCUIT_COOLDOWN_MS) {
    // Half-open: allow a probe by clearing the open flag but keeping the count.
    writeState(circuitKey(name), { failures: state.failures, openedAt: null });
    return false;
  }
  return true;
}
