/** All timestamps are stored as epoch milliseconds in UTC. */
export function nowMs(): number {
  return Date.now();
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Meta Instagram standard messaging window: 24h from the customer's last message. */
export const MESSAGING_WINDOW_MS = 24 * HOUR_MS;

export interface OperatingHours {
  startHour: number;
  endHour: number;
}

/**
 * Parse "HH:MM-HH:MM" into an operating window. Falls back to 09:00-20:00.
 * Minutes are floored to the hour for a simple, predictable gate.
 */
export function parseOperatingHours(raw: string | undefined): OperatingHours {
  const fallback: OperatingHours = { startHour: 9, endHour: 20 };
  if (!raw) return fallback;
  const match = raw.match(/^(\d{1,2}):\d{2}-(\d{1,2}):\d{2}$/);
  if (!match) return fallback;
  const startHour = Number(match[1]);
  const endHour = Number(match[2]);
  if (Number.isNaN(startHour) || Number.isNaN(endHour)) return fallback;
  return { startHour, endHour };
}

/**
 * Whether `ms` falls inside the operating window for the given IANA timezone.
 * We compute the local hour via Intl so behaviour matches the operator's clock.
 */
export function isWithinOperatingHours(
  ms: number,
  hours: OperatingHours,
  timeZone: string,
): boolean {
  const localHour = getLocalHour(ms, timeZone);
  return localHour >= hours.startHour && localHour < hours.endHour;
}

export function getLocalHour(ms: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  });
  const value = formatter.format(new Date(ms));
  // Intl may return "24" at midnight for hour12:false on some runtimes.
  const hour = Number(value) % 24;
  return Number.isNaN(hour) ? 0 : hour;
}

/** YYYY-MM-DD in the given timezone; used for daily counters and budgets. */
export function localDateKey(ms: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  return formatter.format(new Date(ms));
}

/** YYYY-MM in the given timezone; used for monthly OpenAI budget accounting. */
export function localMonthKey(ms: number, timeZone: string): string {
  return localDateKey(ms, timeZone).slice(0, 7);
}
