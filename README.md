# Instagram Autonomous Sales

An autonomous commercial system that prospects on Instagram end to end. It runs a
continuous loop — **Observe → Decide → Act → Measure → Learn → Adapt** — without
message-by-message approval. It operates on its own inside the limits defined in
`.env` and the dashboard; outside those limits it pauses and calls the operator.

> Interface language is **Brazilian Portuguese**. Code, database, internal status
> values, logs, and this technical documentation are in **English**. The operator
> manual lives in [`SETUP.md`](./SETUP.md) (Portuguese).

## What it does

Two funnels, one pipeline engine:

- **Funnel A — customers.** Discover ICP profiles, dedupe against the blocklist and
  do-not-contact list, score ICP fit, send a short personal opening DM **through the
  operator's real Chrome**, then hand the thread off to the official Meta API when the
  lead replies, qualify, handle objections, and route interested leads to WhatsApp.
- **Funnel B — affiliates.** Discover creators in the configured topics/geography,
  approach them the same way, present the affiliate program (only *verified* claims),
  route to the affiliate group, and optimize for affiliates that generate **active
  customers**, not just group joins.

### Channel architecture

1. **Browser (first contact).** Meta's API cannot open a conversation with someone who
   never replied, so the first DM is sent from the operator's real Chrome via Playwright
   over CDP (`chromium.connectOverCDP(CHROME_CDP_URL)`), on a dedicated profile, in the
   agent's own tab, restricted to Instagram, one job at a time (mutex), with human-like
   pacing. If CDP is unavailable the queue pauses and the dashboard is alerted — the
   system never launches its own Chrome.
2. **Official Meta API (continuation).** Inbound replies arrive on the Meta webhook. The
   system matches the Meta thread to the lead, transfers channel ownership to the API,
   and from then on the browser never touches that thread again. Every API send is
   pre-checked (permissions, eligibility, 24h messaging window, conversation state,
   opt-out, channel ownership). API problems go to the exceptions queue — never a
   browser workaround.
3. **WhatsApp (handoff).** Interested shops go to `WHATSAPP_LINK`; interested creators go
   to `AFFILIATE_GROUP_LINK`.

### Conversation engine (OpenAI)

Uses the official OpenAI SDK — `OPENAI_MODEL` for writing/decisions, `OPENAI_MODEL_FAST`
for classification/extraction. Every call records model, tokens, and estimated cost in
`ai_calls`; the system pauses when `OPENAI_MONTHLY_BUDGET_USD` is reached. A **claims
guard** blocks any message that isn't backed by `VERIFIED_CLAIMS` (no superlatives, no
guarantees, no invented rates). Opt-out is honored immediately and permanently
(`do_not_contact`). **With no `OPENAI_API_KEY` set, a deterministic mock engine runs** —
no network calls, no cost — so the whole system works locally out of the box.

## Tech stack

Next.js (App Router) · React · TypeScript `strict` · Tailwind · SQLite · Drizzle ORM
(versioned migrations) · Node.js 24 LTS · pnpm · Playwright (CDP) · OpenAI SDK.

Modular monolith. SQLite is the single source of truth (WAL, foreign keys, unique
constraints, busy timeout, UTC timestamps, automatic backup). The durable job queue is a
SQLite table — no Redis, no external queue.

## Prerequisites

- **Node.js 24 LTS** (`node -v` → `v24.x`). With `nvm`: `nvm install 24 && nvm use 24`.
- **pnpm** (`corepack enable` or `npm i -g pnpm`).

## Quick start (one command)

```bash
pnpm install
cp .env.example .env                      # then edit as needed (mock engine works empty)
cp config/business.example.json config/business.json   # fill in your business data
pnpm dev
```

`pnpm dev` runs migrations, then starts **both** the Next.js panel and the worker
together (via `concurrently`). Open the dashboard at:

```
http://127.0.0.1:4319
```

Optional demo data for the panel:

```bash
pnpm seed
```

## Prove the critical flows (end-to-end demo)

```bash
pnpm demo
```

This runs the full autonomous cycle against the **simulated** browser and the **mock**
AI engine, in an isolated database: discovery → dedupe → browser first contact → inbound
webhook → channel handoff → API reply → intent handling (interested, pricing, opt-out) →
WhatsApp handoff → follow-up scheduling → crash/restart recovery → automatic pause on
risk. It prints each step so you can see every critical flow working.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Migrate, then run panel + worker together (dev). |
| `pnpm build` | Migrate, then production build. |
| `pnpm start` | Run panel + worker together (production). |
| `pnpm worker` / `pnpm worker:dev` | Run just the worker. |
| `pnpm db:generate` | Generate a new Drizzle migration from the schema. |
| `pnpm db:migrate` | Apply migrations. |
| `pnpm seed` | Populate demo data for the panel. |
| `pnpm demo` | Run the end-to-end autonomous-cycle demo. |
| `pnpm backup` | Take a manual SQLite backup (`VACUUM INTO`). |
| `pnpm lint` | ESLint. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` | Vitest suite. |

## Project layout

```
config/business.json         identity, offer, ICP, claims (gitignored)
src/app                      Next.js panel (Server Components, Server Actions, webhook route)
src/features/leads           dedupe, ICP scoring, pipeline/channel state machine
src/features/conversations   message persistence, inbound orchestration, follow-ups
src/features/campaigns       discovery + browser first contact
src/features/experiments     A/B assignment, variants, metrics
src/features/affiliates      affiliate-funnel progression
src/features/dashboard       metrics aggregation
src/integrations/instagram   official Graph API + webhook (signature, idempotency)
src/integrations/browser     Playwright/CDP driver, simulated driver, pacing, mutex
src/integrations/openai      engine, mock, claims guard, budget, pricing
src/integrations/whatsapp    handoff link resolution
src/db                       Drizzle schema, client (WAL/FK), migrations
src/worker                   durable jobs: queue, handlers, runner, entrypoint
src/lib                      result, ids, time, logger, crypto, system-state, i18n, backup
```

## States

Internal values are English; the UI translates them (see `src/lib/i18n.ts`). Pipeline and
channel are **separate** fields on a lead.

- **Customer pipeline:** `discovered` · `qualified` · `contacted` · `replied` ·
  `interested` · `whatsapp_handoff` · `registered` · `active_customer` · `closed`
- **Affiliate pipeline:** `discovered` · `qualified` · `contacted` · `replied` ·
  `interested` · `joined_affiliate_group` · `active_affiliate` · `generated_customer` ·
  `closed`
- **Channel:** `browser_contact_pending` · `browser_contact_sent` ·
  `waiting_inbound_reply` · `api_eligible` · `api_active` · `api_window_closed` ·
  `human_review_required` · `do_not_contact` · `blocked` · `completed`

## Safety & reliability

Env validation (zod) · secrets out of Git · encrypted browser state at rest · webhook
signature verification · structured logging with secret redaction · webhook/job
idempotency · bounded retries with backoff · dead-letter · audit log · circuit breakers ·
global pause · restart recovery · duplicate-send blocking.

Automatic pause on: Instagram alerts/restrictions, session loss, abnormal error growth,
duplicate messages, rising blocks/opt-outs, browser/API/CRM divergence, unexpected AI
behavior, or OpenAI budget overrun.

## Testing

`pnpm test` covers lead dedupe, pipeline/channel transitions, browser first contact,
browser → webhook → API handoff, duplicate-send lock, webhook idempotency, follow-ups,
experiment attribution, restart recovery, API window expiry, do-not-contact, circuit
breaker, and budget cutoff.

Browser testing has three levels: (1) simulated pages + fake CDP client (safe in
containers, used here), (2) real dry-run with the final send blocked, and (3) a limited
real smoke test — **only after explicit operator authorization**. See `SETUP.md`.

## Environment note

In an isolated environment (container/sandbox/cloud) the operator's real Chrome does not
exist. The full browser layer is implemented and tested against simulated pages and a fake
CDP client; keep `BROWSER_DRIVER=simulated`. Switch to `BROWSER_DRIVER=real` (and run the
dry-run / smoke test) only on the operator's own machine as documented in `SETUP.md`.
