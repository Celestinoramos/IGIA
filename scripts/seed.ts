import { loadDotEnv } from "@/lib/dotenv";

/**
 * Populate the local database with a realistic scenario so the panel shows
 * meaningful data on first run. Idempotent-ish: safe to run multiple times
 * (handles are timestamped to avoid unique collisions across runs).
 */
loadDotEnv();
process.env.BROWSER_DRIVER = process.env.BROWSER_DRIVER ?? "simulated";
process.env.DRY_RUN = process.env.DRY_RUN ?? "true";
process.env.OPERATING_HOURS = "00:00-24:00";
process.env.MAX_DMS_PER_DAY = "100";
process.env.PACING_TIME_SCALE = "0.001";

async function main(): Promise<void> {
  const { runMigrations } = await import("@/db/migrate");
  runMigrations();

  const { createExperiment, getActiveExperimentForVariable } = await import("@/features/experiments/engine");
  const { enqueue } = await import("@/worker/queue");
  const { drainQueue } = await import("@/worker/runner");
  const { getLeadByHandle } = await import("@/features/leads/repo");
  const { ingestInbound } = await import("@/features/conversations/service");
  const { getDb } = await import("@/db/client");
  const { leads } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { closeDb } = await import("@/db/client");

  if (!getActiveExperimentForVariable("opener")) {
    createExperiment({
      name: "Estilo de abertura",
      variable: "opener",
      minSampleSize: 20,
      variants: [
        { key: "control", description: "Abertura neutra", isControl: true, weight: 1, payload: { tone: "neutral" } },
        { key: "warm", description: "Abertura mais calorosa", weight: 1, payload: { tone: "warm" } },
      ],
    });
  }

  const s = Date.now().toString().slice(-5);
  const customers = [
    { instagramHandle: `@brecho_ana_${s}`, displayName: "Brechó da Ana", bio: "Loja de roupas e brechó. Dona Ana. Faça seu pedido!", followerCount: 4200, location: "São Paulo", hashtags: ["brecho", "moda"] },
    { instagramHandle: `@burger_ze_${s}`, displayName: "Zé Burger", bio: "Hamburgueria artesanal • delivery", followerCount: 8800, hashtags: ["delivery", "hamburgueria"] },
    { instagramHandle: `@salao_bela_${s}`, displayName: "Salão Bela", bio: "Salão e barbearia. Proprietária Bela.", followerCount: 1500 },
    { instagramHandle: `@mercadinho_${s}`, displayName: "Mercadinho do Bairro", bio: "mercado de bairro", followerCount: 700 },
  ];
  const affiliates = [
    { instagramHandle: `@financas_${s}`, displayName: "Finanças na Prática", bio: "conteúdo de finanças e empreendedorismo", followerCount: 52000, hashtags: ["financas", "empreendedorismo"] },
  ];

  enqueue({ type: "discover_leads", payload: { funnel: "customer", candidates: customers } });
  enqueue({ type: "discover_leads", payload: { funnel: "affiliate", candidates: affiliates } });
  await drainQueue();

  function inbound(handle: string, text: string): void {
    const lead = getLeadByHandle(handle);
    if (!lead) return;
    const senderId = `ig_${handle}`;
    getDb().update(leads).set({ instagramUserId: senderId }).where(eq(leads.id, lead.id)).run();
    ingestInbound({ senderId, mid: newId("mid"), text, timestamp: Date.now() });
  }

  // Simulate a few replies to spread leads across stages.
  inbound(`@brecho_ana_${s}`, "Oi! Como funciona?");
  await drainQueue();
  inbound(`@brecho_ana_${s}`, "Gostei, tenho interesse!");
  await drainQueue();
  inbound(`@salao_bela_${s}`, "quanto custa a taxa?");
  await drainQueue();
  inbound(`@financas_${s}`, "tenho interesse na parceria");
  await drainQueue();

  // Affiliate progression.
  const { markJoinedAffiliateGroup, markAffiliateActive } = await import("@/features/affiliates/service");
  const fin = getLeadByHandle(`@financas_${s}`);
  if (fin) {
    markJoinedAffiliateGroup(fin.id);
    markAffiliateActive(fin.id);
  }

  const { getDashboardMetrics } = await import("@/features/dashboard/metrics");
  const m = getDashboardMetrics();
  console.log(`Seed complete. Leads: ${m.totals.leads}, respondidos: ${m.totals.replied}, exceções: ${m.openExceptions}.`);
  closeDb();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
