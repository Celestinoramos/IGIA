/** Diagnostics captured when a browser send fails, for the exceptions queue. */
export interface FailureArtifacts {
  screenshotPath?: string;
  accessibilitySnapshot?: string;
  url?: string;
  consoleErrors?: string[];
  networkFailures?: string[];
  jobId?: string;
}

export type DriverSendResult =
  | { ok: true; deliveredAt: number; dryRun: boolean }
  | { ok: false; error: string; unavailable?: boolean; artifacts?: FailureArtifacts };

export interface SendDmParams {
  handle: string;
  message: string;
  /** Per-character typing delay in ms (human pacing). */
  typingDelayMs: number;
  /** When true, do everything up to but NOT including the final send. */
  dryRun: boolean;
  jobId?: string;
}

/**
 * A browser driver performs structured, validated actions against Instagram.
 * The worker never issues free-form "chat" commands — it calls typed methods
 * and validates each result. Implementations must stay within instagram.com.
 */
export interface BrowserDriver {
  readonly name: "real" | "simulated";
  connect(): Promise<{ ok: true } | { ok: false; error: string; unavailable: boolean }>;
  sendDirectMessage(params: SendDmParams): Promise<DriverSendResult>;
  close(): Promise<void>;
}
