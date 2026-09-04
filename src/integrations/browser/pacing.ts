import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dailyCounters } from "@/db/schema";
import { getEnv } from "@/config/env";
import {
  isWithinOperatingHours,
  localDateKey,
  nowMs,
  parseOperatingHours,
  DAY_MS,
} from "@/lib/time";
import { getWarmupStartMs } from "@/lib/system-state";

/**
 * Human pacing exists for account health — the same discipline a real SDR
 * follows — not to evade detection. It gates volume, timing and warmup.
 */

export function randomDelayMs(): number {
  const env = getEnv();
  const min = env.MIN_SECONDS_BETWEEN_DMS * 1000;
  const max = env.MAX_SECONDS_BETWEEN_DMS * 1000;
  const raw = min + Math.random() * (max - min);
  return Math.round(raw * env.PACING_TIME_SCALE);
}

export function typingDelayPerCharMs(): number {
  const env = getEnv();
  const raw = 40 + Math.random() * 50;
  // Floor of 0 lets tests set PACING_TIME_SCALE=0 for deterministic, yield-free
  // runs. In production (scale 1) this yields a natural ~40–90ms per character.
  return Math.max(0, Math.round(raw * env.PACING_TIME_SCALE));
}

/** Warmup: 5/day in week 1, +5 each week, capped at MAX_DMS_PER_DAY. */
export function currentDailyLimit(): number {
  const env = getEnv();
  // Clamp to >= 0 so a clock/anchor skew can never drop below the week-1 cap.
  const weeksElapsed = Math.max(0, Math.floor((nowMs() - getWarmupStartMs()) / (7 * DAY_MS)));
  const warmupCap = (weeksElapsed + 1) * 5;
  return Math.min(warmupCap, env.MAX_DMS_PER_DAY);
}

function todayKey(): string {
  return localDateKey(nowMs(), getEnv().OPERATING_TIMEZONE);
}

export function dmsSentToday(): number {
  const row = getDb().select().from(dailyCounters).where(eq(dailyCounters.dateKey, todayKey())).get();
  return row?.dmsSent ?? 0;
}

export function incrementDmsSentToday(): void {
  const key = todayKey();
  getDb()
    .insert(dailyCounters)
    .values({ dateKey: key, dmsSent: 1 })
    .onConflictDoUpdate({
      target: dailyCounters.dateKey,
      set: { dmsSent: sql`${dailyCounters.dmsSent} + 1` },
    })
    .run();
}

export interface PacingGate {
  allowed: boolean;
  reason?: string;
  dailyLimit: number;
  sentToday: number;
}

/** Whether a browser DM may be sent right now (hours + daily/warmup cap). */
export function checkBrowserPacing(): PacingGate {
  const env = getEnv();
  const hours = parseOperatingHours(env.OPERATING_HOURS);
  const dailyLimit = currentDailyLimit();
  const sentToday = dmsSentToday();

  if (!isWithinOperatingHours(nowMs(), hours, env.OPERATING_TIMEZONE)) {
    return { allowed: false, reason: "outside_operating_hours", dailyLimit, sentToday };
  }
  if (sentToday >= dailyLimit) {
    return { allowed: false, reason: "daily_limit_reached", dailyLimit, sentToday };
  }
  return { allowed: true, dailyLimit, sentToday };
}
