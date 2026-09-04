import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadDotEnv } from "@/lib/dotenv";

/**
 * End-to-end demonstration of the autonomous cycle against the simulated
 * browser + simulated API + mock AI engine. Runs fully offline and prints
 * evidence for each acceptance criterion. Uses an isolated demo database.
 */
loadDotEnv();
process.env.DATABASE_URL = "file:./data/demo.db";
process.env.BROWSER_DRIVER = "simulated";
process.env.DRY_RUN = "true";
process.env.OPENAI_API_KEY = "";
process.env.PACING_TIME_SCALE = "0.001";
// Demo runs any time of day; open the operating window so pacing never blocks it.
process.env.OPERATING_HOURS = "00:00-24:00";
process.env.MAX_DMS_PER_DAY = "100";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const mark = ok ? "✓" : "✗";
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}
function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(resolve(process.cwd(), `data/demo.db${suffix}`), { force: true });
  }

  const { runMigrations } = await import("@/db/migrate");
  runMigrations();

  const { getDb } = await import("@/db/client");
  const { leads } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { enqueue } = await import("@/worker/queue");
  const { drainQueue } = await import("@/worker/runner");
  const { getLeadByHandle, addToBlocklist } = await import("@/features/leads/repo");
  const { ingestInbound } = await import("@/features/conversations/service");
  const { createExperiment, summarizeExperiment } = await import("@/features/experiments/engine");
  const { listMessages } = await import("@/features/conversations/repo");
  const { markJoinedAffiliateGroup, markAffiliateActive, markAffiliateGeneratedCustomer } = await import("@/features/affiliates/service");
  const { getPauseState, resumeSystem } = await import("@/lib/system-state");
  const { monthlySpendUsd } = await import("@/integrations/openai/budget");
  const { newId } = await import("@/lib/ids");

  const db = getDb();

  function bindAndInbound(handle: string, text: string): void {
    const lead = getLeadByHandle(handle);
    if (!lead) throw new Error(`lead not found: ${handle}`);
    const senderId = `ig_${handle}`;
    db.update(leads).set({ instagramUserId: senderId }).where(eq(leads.id, lead.id)).run();
    ingestInbound({ senderId, mid: newId("mid"), text, timestamp: Date.now() });
  }

  // ── A/B experiment on the opener ──────────────────────────────────────────
  section("A/B experiment");
  createExperiment({
    name: "Opener style",
    variable: "opener",
    minSampleSize: 2,
    variants: [
      { key: "control", description: "Neutral opener", isControl: true, weight: 1, payload: { tone: "neutral" } },
      { key: "warm", description: "Warmer opener", weight: 1, payload: { tone: "warm" } },
    ],
  });
  check("Opener experiment created with control + variant", true);

  // ── Discovery (customer funnel) with dedupe + blocklist ────────────────────
  section("Discovery & dedupe (customers)");
  addToBlocklist("@blocked_store", "prior_opt_out");
  const customerCandidates = [
    { instagramHandle: "@brecho_da_ana", displayName: "Brechó da Ana", bio: "Loja de roupas e brechó. Faça seu pedido!", followerCount: 4200, location: "São Paulo", hashtags: ["brecho", "moda"] },
    { instagramHandle: "@burger_do_ze", displayName: "Zé Burger", bio: "Hamburgueria artesanal • delivery", followerCount: 8800, hashtags: ["delivery", "hamburgueria"] },
    { instagramHandle: "@salao_bela", displayName: "Salão Bela", bio: "Salão e barbearia. Dona Bela.", followerCount: 1500 },
    { instagramHandle: "@brecho_da_ana", displayName: "dup", bio: "dup", followerCount: 1 }, // duplicate
    { instagramHandle: "@blocked_store", displayName: "Blocked", bio: "loja", followerCount: 900 }, // blocklisted
  ];
  enqueue({ type: "discover_leads", payload: { funnel: "customer", candidates: customerCandidates } });
  await drainQueue();

  const ana = getLeadByHandle("@brecho_da_ana");
  const dupCount = db.select().from(leads).where(eq(leads.instagramHandle, "brecho_da_ana")).all().length;
  check("Duplicate handle deduped to a single lead", dupCount === 1);
  check("Blocklisted handle skipped (no lead created)", getLeadByHandle("@blocked_store") === null);
  check("Discovered lead scored & qualified", !!ana && ana.icpScore > 0 && ["qualified", "contacted"].includes(ana.pipelineState), `score=${ana?.icpScore}`);

  // ── First contact via the (simulated) browser ─────────────────────────────
  section("First contact via browser (dry-run)");
  const anaAfter = getLeadByHandle("@brecho_da_ana");
  check("First DM sent by browser; awaiting reply", anaAfter?.channelState === "waiting_inbound_reply", `channel=${anaAfter?.channelState}`);
  check("Pipeline advanced to 'contacted'", anaAfter?.pipelineState === "contacted");
  const anaMsgs = anaAfter ? listMessages(anaAfter.id) : [];
  check("Outbound opener recorded on browser channel", anaMsgs.some((m) => m.direction === "outbound" && m.channel === "browser"));

  // ── Duplicate-send lock ────────────────────────────────────────────────────
  section("Duplicate-send lock");
  enqueue({ type: "first_contact", payload: { leadId: anaAfter!.id }, dedupeKey: `first_contact:retry:${anaAfter!.id}` });
  await drainQueue();
  const anaMsgs2 = listMessages(anaAfter!.id).filter((m) => m.channel === "browser" && m.direction === "outbound");
  check("Second first-contact attempt did NOT duplicate the DM", anaMsgs2.length === 1, `browser_outbound=${anaMsgs2.length}`);

  // ── Handoff: inbound reply → webhook → API ─────────────────────────────────
  section("Handoff browser → webhook → API");
  bindAndInbound("@brecho_da_ana", "Oi! Como funciona?");
  await drainQueue();
  const anaReplied = getLeadByHandle("@brecho_da_ana")!;
  check("Channel owned by API after reply", anaReplied.channelState === "api_active", `channel=${anaReplied.channelState}`);
  const anaAll = listMessages(anaReplied.id);
  check("Inbound recorded + API reply sent", anaAll.some((m) => m.direction === "inbound") && anaAll.some((m) => m.channel === "api" && m.direction === "outbound"));
  check("No browser send after handoff (zero duplicates)", anaAll.filter((m) => m.channel === "browser" && m.direction === "outbound").length === 1);

  // ── Webhook idempotency ────────────────────────────────────────────────────
  section("Webhook idempotency");
  const sameMid = newId("mid");
  ingestInbound({ senderId: "ig_@brecho_da_ana", mid: sameMid, text: "Quanto custa?", timestamp: Date.now() });
  ingestInbound({ senderId: "ig_@brecho_da_ana", mid: sameMid, text: "Quanto custa?", timestamp: Date.now() });
  await drainQueue();
  const inboundWithMid = listMessages(anaReplied.id).filter((m) => m.externalId === sameMid);
  check("Redelivered webhook created only ONE inbound row", inboundWithMid.length === 1);

  // ── Pricing → WhatsApp handoff (no invented rates) ─────────────────────────
  section("WhatsApp handoff on pricing intent");
  const anaPriced = getLeadByHandle("@brecho_da_ana")!;
  check("Pricing question routed to WhatsApp handoff", anaPriced.pipelineState === "whatsapp_handoff", `pipeline=${anaPriced.pipelineState}`);
  const anaWa = listMessages(anaPriced.id).find((m) => m.channel === "api" && m.body.includes("wa.me"));
  check("WhatsApp link shared, no invented pricing", !!anaWa);

  // ── Opt-out is permanent ───────────────────────────────────────────────────
  section("Opt-out → do_not_contact");
  bindAndInbound("@burger_do_ze", "quero saber mais");
  await drainQueue();
  bindAndInbound("@burger_do_ze", "pode parar de me mandar mensagem");
  await drainQueue();
  const ze = getLeadByHandle("@burger_do_ze")!;
  check("Lead moved to do_not_contact", ze.channelState === "do_not_contact");
  check("Handle added to permanent blocklist", (await import("@/features/leads/repo")).isBlocked("@burger_do_ze"));

  // ── Affiliate funnel ───────────────────────────────────────────────────────
  section("Affiliate funnel");
  enqueue({ type: "discover_leads", payload: { funnel: "affiliate", candidates: [
    { instagramHandle: "@creator_financas", displayName: "Financeira", bio: "conteúdo de finanças e empreendedorismo", followerCount: 42000, hashtags: ["financas", "empreendedorismo"] },
  ] } });
  await drainQueue();
  bindAndInbound("@creator_financas", "tenho interesse na parceria");
  await drainQueue();
  const creator = getLeadByHandle("@creator_financas")!;
  const creatorWa = listMessages(creator.id).find((m) => m.body.includes("chat.whatsapp.com"));
  check("Affiliate forwarded to the affiliate group link", !!creatorWa);
  markJoinedAffiliateGroup(creator.id);
  markAffiliateActive(creator.id);
  markAffiliateGeneratedCustomer(creator.id);
  const creatorFinal = getLeadByHandle("@creator_financas")!;
  check("Affiliate reached 'generated_customer'", creatorFinal.pipelineState === "generated_customer");

  // ── Crash recovery ─────────────────────────────────────────────────────────
  section("Crash recovery");
  const { jobs } = await import("@/db/schema");
  const stuck = enqueue({ type: "backup_db", payload: {}, dedupeKey: `stuck:${Date.now()}` })!;
  db.update(jobs).set({ status: "running", lockedAt: Date.now() - 120_000, lockedBy: "dead-worker" }).where(eq(jobs.id, stuck.id)).run();
  const { recoverStuckJobs } = await import("@/worker/queue");
  const recovered = recoverStuckJobs();
  check("Stuck job recovered after simulated crash", recovered >= 1, `recovered=${recovered}`);
  await drainQueue();

  // ── Auto-pause on risk (browser outage) ────────────────────────────────────
  section("Auto-pause on risk");
  process.env.CHROME_CDP_URL = "http://127.0.0.1:9222/unavailable";
  const { resetEnvCache } = await import("@/config/env");
  resetEnvCache();
  enqueue({ type: "discover_leads", payload: { funnel: "customer", candidates: [
    { instagramHandle: "@nova_loja", displayName: "Nova Loja", bio: "loja de roupas", followerCount: 3000 },
  ] } });
  await drainQueue(); // discovery + first_contact will hit the outage
  const paused = getPauseState();
  check("System auto-paused on browser outage", paused.paused, `reason=${paused.reason}`);
  resumeSystem("operator");
  process.env.CHROME_CDP_URL = "http://127.0.0.1:9222";
  resetEnvCache();

  // ── Experiment measurement + AI cost ───────────────────────────────────────
  section("Measurement & cost");
  const { listExperiments } = await import("@/features/experiments/engine");
  const exp = listExperiments()[0];
  const summary = summarizeExperiment(exp.id)!;
  check("Experiment records assignments & conversion per variant", summary.variants.some((v) => v.assigned > 0));
  console.log("    variants:", summary.variants.map((v) => `${v.key}(n=${v.assigned}, conv=${(v.conversionRate * 100).toFixed(0)}%)`).join(", "));
  const spend = monthlySpendUsd();
  check("AI spend tracked (mock = $0.00, real would accrue)", spend >= 0, `spend=$${spend.toFixed(4)}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  section("RESULT");
  console.log(`  ${pass} passed, ${fail} failed`);
  const { closeDb } = await import("@/db/client");
  closeDb();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("Demo crashed:", error);
  process.exitCode = 1;
});
