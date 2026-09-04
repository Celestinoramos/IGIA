import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { getEnv } from "@/config/env";
import { nowMs } from "@/lib/time";
import { logger } from "@/lib/logger";
import type { BrowserDriver, DriverSendResult, FailureArtifacts, SendDmParams } from "./types";

const INSTAGRAM_ORIGIN = "https://www.instagram.com";

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Connects to the operator's already-logged-in Chrome over CDP. It NEVER opens
 * a new Chrome, adopts the user's tab, calls bringToFront, or touches the
 * mouse/keyboard globally. It works in its own tab, closes it in a finally
 * block, and stays restricted to instagram.com.
 *
 * This code path only runs on the operator's machine (BROWSER_DRIVER=real);
 * in containers the simulated driver is used instead.
 */
export class RealBrowserDriver implements BrowserDriver {
  readonly name = "real" as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async connect(): Promise<{ ok: true } | { ok: false; error: string; unavailable: boolean }> {
    const url = getEnv().CHROME_CDP_URL;
    if (!url) return { ok: false, error: "CHROME_CDP_URL is not set", unavailable: true };
    try {
      this.browser = await chromium.connectOverCDP(url);
      const contexts = this.browser.contexts();
      if (contexts.length === 0) {
        await this.browser.close().catch(() => undefined);
        this.browser = null;
        return { ok: false, error: "no existing browser context (is Chrome logged in?)", unavailable: true };
      }
      // Reuse the operator's already-authenticated context.
      this.context = contexts[0];
      return { ok: true };
    } catch (error) {
      // Do NOT fall back to launching a new Chrome. Signal outage instead.
      return { ok: false, error: `connectOverCDP failed: ${String(error)}`, unavailable: true };
    }
  }

  async sendDirectMessage(params: SendDmParams): Promise<DriverSendResult> {
    if (!this.context) return { ok: false, error: "not connected", unavailable: true };

    // Own tab for the agent. Never adopt the user's tab.
    const page = await this.context.newPage();
    const consoleErrors: string[] = [];
    const networkFailures: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("requestfailed", (r) => {
      networkFailures.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "failed"}`);
    });

    try {
      await this.guardInstagramOnly(page);
      const handle = params.handle.replace(/^@+/, "");
      await page.goto(`${INSTAGRAM_ORIGIN}/${handle}/`, { waitUntil: "domcontentloaded" });

      // Prefer accessibility roles / stable references over brittle CSS.
      const messageButton = page.getByRole("button", { name: /message|mensagem/i });
      await messageButton.waitFor({ state: "visible", timeout: 15000 });
      await messageButton.click();

      const composer = page.getByRole("textbox").first();
      await composer.waitFor({ state: "visible", timeout: 15000 });
      await composer.click();

      // Type with per-character delay (human cadence).
      await composer.pressSequentially(params.message, { delay: params.typingDelayMs });
      // Pause before sending, as a person re-reads.
      await sleep(params.typingDelayMs * 8);

      if (params.dryRun) {
        logger.info("Real DM prepared (dry-run, not sent)", { handle });
        return { ok: true, deliveredAt: nowMs(), dryRun: true };
      }

      await composer.press("Enter");
      // Verify the message appears in the thread before declaring success.
      await page.getByText(params.message, { exact: false }).first().waitFor({ timeout: 10000 });
      return { ok: true, deliveredAt: nowMs(), dryRun: false };
    } catch (error) {
      const artifacts = await this.captureArtifacts(page, params.jobId, consoleErrors, networkFailures);
      return { ok: false, error: String(error), artifacts };
    } finally {
      // Always close the agent's tab, including on error.
      await page.close().catch(() => undefined);
    }
  }

  /** Restrict navigation to instagram.com; abort anything else. */
  private async guardInstagramOnly(page: Page): Promise<void> {
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      const allowed = target.hostname.endsWith("instagram.com") || target.hostname.endsWith("cdninstagram.com") || target.hostname.endsWith("fbcdn.net");
      if (allowed) route.continue();
      else route.abort();
    });
  }

  private async captureArtifacts(
    page: Page,
    jobId: string | undefined,
    consoleErrors: string[],
    networkFailures: string[],
  ): Promise<FailureArtifacts> {
    const dir = resolve(process.cwd(), "screenshots");
    mkdirSync(dir, { recursive: true });
    const screenshotPath = resolve(dir, `fail-${jobId ?? nowMs()}.png`);
    let accessibilitySnapshot = "";
    try {
      await page.screenshot({ path: screenshotPath });
      // Prefer a stable ARIA snapshot over brittle DOM dumps.
      accessibilitySnapshot = await page.locator("body").ariaSnapshot();
    } catch {
      // Best-effort diagnostics.
    }
    return {
      screenshotPath,
      accessibilitySnapshot,
      url: page.url(),
      consoleErrors,
      networkFailures,
      jobId,
    };
  }

  async close(): Promise<void> {
    // Disconnect from CDP without closing the operator's Chrome.
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
  }
}
