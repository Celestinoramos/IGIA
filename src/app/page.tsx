import { getDashboardMetrics } from "@/features/dashboard/metrics";
import Link from "next/link";
import { Card, StatCard, PageHeader, Badge } from "@/components/ui";
import { PIPELINE_LABELS, formatUsd, formatNumber } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const m = getDashboardMetrics();

  return (
    <div>
      <PageHeader
        title="Painel geral"
        description="Visão do ciclo autônomo: observar, decidir, agir, medir, aprender e adaptar — dentro dos limites configurados."
        actions={
          <Link href="/import" className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            Importar leads
          </Link>
        }
      />

      {m.configHasPlaceholders ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/10">
          <div className="text-sm text-amber-200">
            Atenção: o arquivo <code>config/business.json</code> ainda contém valores de exemplo (<code>{"{{...}}"}</code>). Preencha com os dados reais do negócio antes de operar.
          </div>
        </Card>
      ) : null}

      {m.pause.paused ? (
        <Card className="mb-4 border-red-500/40 bg-red-500/10">
          <div className="text-sm text-red-200">
            Sistema pausado{m.pause.reason ? ` — motivo: ${m.pause.reason}` : ""}. Nenhuma ação de prospecção será executada até retomar.
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Leads totais" value={formatNumber(m.totals.leads)} />
        <StatCard label="Responderam" value={formatNumber(m.totals.replied)} tone="ok" />
        <StatCard label="Interessados" value={formatNumber(m.totals.interested)} tone="ok" />
        <StatCard label="Clientes ativos" value={formatNumber(m.totals.activeCustomers)} tone="ok" />
        <StatCard label="Afiliados ativos" value={formatNumber(m.totals.activeAffiliates)} />
        <StatCard label="Exceções abertas" value={formatNumber(m.openExceptions)} tone={m.openExceptions > 0 ? "warn" : "default"} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          label="DMs enviadas hoje"
          value={`${m.pacing.sentToday} / ${m.pacing.dailyLimit}`}
          hint={`Limite de aquecimento hoje: ${m.pacing.dailyLimit} (máx. configurado ${m.pacing.maxPerDay})`}
          tone={m.pacing.sentToday >= m.pacing.dailyLimit ? "warn" : "default"}
        />
        <StatCard
          label="Custo de IA no mês"
          value={`${formatUsd(m.budget.spend)} / ${formatUsd(m.budget.budget)}`}
          hint={`${m.budget.pct.toFixed(1)}% do orçamento • pausa automática ao atingir 100%`}
          tone={m.budget.pct >= 90 ? "danger" : m.budget.pct >= 60 ? "warn" : "default"}
        />
        <StatCard
          label="Custo por lead / por cliente ativo"
          value={`${formatUsd(m.cost.perLead)} / ${formatUsd(m.cost.perActiveCustomer)}`}
          hint="Sem isto não dá para saber se a automação dá lucro."
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {m.funnels.map((f) => (
          <Card key={f.funnel}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Funil de {f.funnel === "customer" ? "clientes" : "afiliados"}
              </h2>
              <Badge tone="brand">{formatNumber(f.total)} leads</Badge>
            </div>
            <div className="space-y-1.5">
              {Object.entries(f.byPipeline).map(([stage, count]) => (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-44 text-xs text-[var(--muted)]">{PIPELINE_LABELS[stage as keyof typeof PIPELINE_LABELS]}</div>
                  <div className="h-2 flex-1 rounded bg-[var(--surface-2)]">
                    <div
                      className="h-2 rounded bg-[var(--brand)]"
                      style={{ width: `${f.total > 0 ? (count / f.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="w-8 text-right text-xs">{count}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Estado do canal</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(m.channelCounts)
              .filter(([, c]) => c > 0)
              .map(([state, count]) => (
                <Badge key={state}>{state}: {count}</Badge>
              ))}
            {Object.values(m.channelCounts).every((c) => c === 0) ? (
              <span className="text-sm text-[var(--muted)]">Nenhum lead ainda.</span>
            ) : null}
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Fila de jobs</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(m.jobs).map(([status, count]) => (
              <Badge key={status} tone={status === "dead" ? "danger" : status === "pending" ? "warn" : "neutral"}>
                {status}: {count}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
