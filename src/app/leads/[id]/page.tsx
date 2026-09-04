import Link from "next/link";
import { notFound } from "next/navigation";
import { getLead } from "@/features/leads/repo";
import { listMessages } from "@/features/conversations/repo";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { Card, PageHeader } from "@/components/ui";
import { PIPELINE_LABELS, CHANNEL_LABELS, PROFILE_TYPE_LABELS, formatDateTime, formatNumber } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) notFound();

  const messages = listMessages(id);
  const timeline = getDb().select().from(events).where(eq(events.leadId, id)).orderBy(desc(events.createdAt)).all();

  return (
    <div>
      <PageHeader
        title={`@${lead.instagramHandle}`}
        description={lead.displayName ?? undefined}
        actions={<Link href={`/leads?funnel=${lead.funnel}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-sm">← Voltar ao funil</Link>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Cadastro</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Funil" value={lead.funnel === "customer" ? "Clientes" : "Afiliados"} />
              <Row label="Etapa do funil" value={PIPELINE_LABELS[lead.pipelineState]} />
              <Row label="Canal" value={CHANNEL_LABELS[lead.channelState]} />
              <Row label="Tipo de perfil" value={PROFILE_TYPE_LABELS[lead.profileType]} />
              <Row label="Score ICP" value={formatNumber(Math.round(lead.icpScore))} />
              <Row label="Nicho" value={lead.niche ?? "—"} />
              <Row label="Origem" value={lead.source ?? "—"} />
              <Row label="Palavra-chave" value={lead.keyword ?? "—"} />
              <Row label="Seguidores" value={lead.followerCount ? formatNumber(lead.followerCount) : "—"} />
              <Row label="Última resposta" value={formatDateTime(lead.lastInboundAt)} />
              <Row label="Próxima ação" value={formatDateTime(lead.nextActionAt)} />
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Linha do tempo</h2>
            <div className="space-y-2">
              {timeline.length === 0 ? <div className="text-xs text-[var(--muted)]">Sem eventos.</div> : null}
              {timeline.map((e) => (
                <div key={e.id} className="text-xs">
                  <span className="text-[var(--muted)]">{formatDateTime(e.createdAt)}</span>{" "}
                  <span className="font-medium">{e.type}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Conversa</h2>
            <div className="space-y-3">
              {messages.length === 0 ? <div className="text-sm text-[var(--muted)]">Nenhuma mensagem ainda.</div> : null}
              {messages.map((msg) => {
                const outbound = msg.direction === "outbound";
                return (
                  <div key={msg.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${outbound ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)]"}`}>
                      <div className="text-sm">{msg.body}</div>
                      <div className={`mt-1 flex items-center gap-2 text-[10px] ${outbound ? "text-white/70" : "text-[var(--muted)]"}`}>
                        <span>{formatDateTime(msg.createdAt)}</span>
                        <span>· {msg.channel}</span>
                        {msg.intent ? <span>· {msg.intent}</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
