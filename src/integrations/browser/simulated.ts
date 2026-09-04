import { getEnv } from "@/config/env";
import { nowMs } from "@/lib/time";
import { logger } from "@/lib/logger";
import type { BrowserDriver, DriverSendResult, SendDmParams } from "./types";

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Simulated driver for containers/CI. It exercises the FULL send pipeline —
 * pacing, typing cadence, dry-run gate, structured result — against an
 * in-memory page instead of a real Chrome. Handles containing "fail" or
 * "unavailable" let tests drive the error and outage paths deterministically.
 */
export class SimulatedBrowserDriver implements BrowserDriver {
  readonly name = "simulated" as const;
  private connected = false;

  async connect(): Promise<{ ok: true } | { ok: false; error: string; unavailable: boolean }> {
    // Simulated CDP endpoint is always reachable unless the test forces an outage.
    if ((getEnv().CHROME_CDP_URL ?? "").includes("unavailable")) {
      return { ok: false, error: "simulated CDP endpoint unavailable", unavailable: true };
    }
    this.connected = true;
    return { ok: true };
  }

  async sendDirectMessage(params: SendDmParams): Promise<DriverSendResult> {
    if (!this.connected) {
      return { ok: false, error: "driver not connected", unavailable: true };
    }
    if (params.handle.includes("fail")) {
      return {
        ok: false,
        error: "simulated send failure",
        artifacts: {
          screenshotPath: `screenshots/simulated-${params.handle}.png`,
          accessibilitySnapshot: "role=dialog name='Nova mensagem' (simulated)",
          url: `https://www.instagram.com/direct/t/${params.handle}`,
          consoleErrors: ["simulated console error"],
          networkFailures: [],
          jobId: params.jobId,
        },
      };
    }

    // Emulate opening the composer and typing at human cadence.
    const typingTotal = Math.min(params.message.length * params.typingDelayMs, 4000);
    await sleep(typingTotal);
    // Small pause before sending, as a person re-reads the message.
    await sleep(params.typingDelayMs * 5);

    if (params.dryRun) {
      logger.info("Simulated DM prepared (dry-run, not sent)", {
        handle: params.handle,
        length: params.message.length,
      });
      return { ok: true, deliveredAt: nowMs(), dryRun: true };
    }

    logger.info("Simulated DM sent", { handle: params.handle });
    return { ok: true, deliveredAt: nowMs(), dryRun: false };
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}
