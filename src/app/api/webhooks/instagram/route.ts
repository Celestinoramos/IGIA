import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { getDb } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowMs } from "@/lib/time";
import {
  verifyWebhookSignature,
  verifyWebhookChallenge,
  parseInboundEvents,
} from "@/integrations/instagram/webhook";
import { ingestInbound } from "@/features/conversations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: Meta subscription verification handshake. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const challenge = verifyWebhookChallenge(
    url.searchParams.get("hub.mode"),
    url.searchParams.get("hub.verify_token"),
    url.searchParams.get("hub.challenge"),
    getEnv().INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
  );
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

/**
 * POST: inbound message events. Verifies the HMAC signature, dedupes by event
 * id (idempotency ledger), then ingests each message — matching the lead and
 * handing channel ownership to the API.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const env = getEnv();

  if (!verifyWebhookSignature(raw, signature, env.INSTAGRAM_APP_SECRET)) {
    logger.warn("Rejected webhook with invalid signature");
    return new NextResponse("invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  const events = parseInboundEvents(body);
  const db = getDb();
  for (const event of events) {
    // Idempotency: skip if we've already processed this Meta message id.
    const ledger = db
      .insert(webhookEvents)
      .values({ id: newId("wh"), externalId: event.mid, payload: event as unknown as Record<string, unknown>, processedAt: nowMs() })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!ledger) {
      logger.info("Skipping duplicate webhook event", { mid: event.mid });
      continue;
    }
    ingestInbound(event);
  }

  // Always 200 quickly so Meta does not retry unnecessarily.
  return NextResponse.json({ received: events.length });
}
