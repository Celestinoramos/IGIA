import Link from "next/link";
import { listLeadsByPipeline } from "@/features/leads/repo";
import { pipelineFor, type Funnel } from "@/features/leads/states";
import { PageHeader, Badge, EmptyState, Card } from "@/components/ui";
import { PIPELINE_LABELS, CHANNEL_LABELS, PROFILE_TYPE_LABELS } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ funnel?: string }>;
}) {
  const params = await searchParams;
  const funnel: Funnel = params.funnel === "affiliate" ? "affiliate" : "customer";
  const grouped = listLeadsByPipeline(funnel);
  const stages = pipelineFor(funnel);
  const total = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);

  return (
    <div>
      <PageHeader
        title={`Funil de ${funnel === "customer" ? "clientes" : "afiliados"}`}
        description="Kanban separado por funil. A prospecção fica separada das conversas pessoais do Instagram."
        actions={
          <div className="flex gap-2">
            <Link
              href="/leads?funnel=customer"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${funnel === "customer" ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] bg-[var(--surface-2)]"}`}
            >
              Clientes
            </Link>
            <Link
              href="/leads?funnel=affiliate"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${funnel === "affiliate" ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] bg-[var(--surface-2)]"}`}
            >
              Afiliados
            </Link>
          </div>
        }
      />

      {total === 0 ? (
        <EmptyState
          title="Nenhum lead neste funil ainda"
          description="Use “Simular descoberta” no painel geral para popular o funil, ou deixe o worker rodar a descoberta."
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto scroll-x pb-4">
          {stages.map((stage) => {
            const leads = grouped[stage] ?? [];
            return (
              <div key={stage} className="w-72 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{PIPELINE_LABELS[stage]}</span>
                  <span className="text-xs text-[var(--muted)]">{leads.length}</span>
                </div>
                <div className="space-y-2">
                  {leads.map((lead) => (
                    <Link key={lead.id} href={`/leads/${lead.id}`}>
                      <Card className="hover:border-[var(--brand)]">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">@{lead.instagramHandle}</span>
                          <Badge tone={lead.priority >= 3 ? "ok" : lead.priority >= 2 ? "brand" : "neutral"}>
                            score {Math.round(lead.icpScore)}
                          </Badge>
                        </div>
                        {lead.displayName ? <div className="mt-0.5 text-xs text-[var(--muted)]">{lead.displayName}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge>{PROFILE_TYPE_LABELS[lead.profileType]}</Badge>
                          <Badge tone="brand">{CHANNEL_LABELS[lead.channelState]}</Badge>
                        </div>
                      </Card>
                    </Link>
                  ))}
                  {leads.length === 0 ? <div className="px-1 text-xs text-[var(--muted)]">—</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
