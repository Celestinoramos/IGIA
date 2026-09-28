import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import {
  verifyWebhookSignature,
  verifyWebhookChallenge,
  parseInboundEvents,
} from "@/integrations/instagram/webhook";
import { ingestWebhookEvents } from "@/features/conversations/service";

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
 * POST: inbound message events. Verifies the HMAC signature, then dedupes and
 * ingests each message — matching the lead and handing channel ownership to
 * the API.
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
  const result = ingestWebhookEvents(events);

  // A failed event was rolled back: answer 500 so Meta redelivers it. Events
  // that did succeed are skipped on redelivery by the idempotency ledger.
  if (result.failed > 0) return NextResponse.json({ received: events.length, ...result }, { status: 500 });
  return NextResponse.json({ received: events.length, ...result });
}
