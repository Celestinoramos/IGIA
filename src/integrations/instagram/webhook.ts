import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify the X-Hub-Signature-256 header against the raw request body using the
 * app secret. Constant-time comparison avoids timing leaks.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Meta webhook GET verification handshake. Returns the challenge or null. */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  verifyToken: string | undefined,
): string | null {
  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    return challenge;
  }
  return null;
}

export interface InboundMessageEvent {
  senderId: string;
  recipientId: string;
  mid: string;
  text: string;
  timestamp: number;
}

/** Normalise an Instagram webhook body into inbound message events. */
export function parseInboundEvents(body: unknown): InboundMessageEvent[] {
  const events: InboundMessageEvent[] = [];
  if (!body || typeof body !== "object") return events;
  const root = body as { object?: string; entry?: unknown[] };
  if (root.object !== "instagram" || !Array.isArray(root.entry)) return events;

  for (const entry of root.entry) {
    const messaging = (entry as { messaging?: unknown[] }).messaging;
    if (!Array.isArray(messaging)) continue;
    for (const m of messaging) {
      const msg = m as {
        sender?: { id?: string };
        recipient?: { id?: string };
        timestamp?: number;
        message?: { mid?: string; text?: string; is_echo?: boolean };
      };
      // Skip echoes (our own outbound reflected back) and non-text events.
      if (msg.message?.is_echo) continue;
      const senderId = msg.sender?.id;
      const mid = msg.message?.mid;
      const text = msg.message?.text;
      if (!senderId || !mid || typeof text !== "string") continue;
      events.push({
        senderId,
        recipientId: msg.recipient?.id ?? "",
        mid,
        text,
        timestamp: msg.timestamp ?? Date.now(),
      });
    }
  }
  return events;
}
