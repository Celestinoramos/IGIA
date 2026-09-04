import { listExperiments, summarizeExperiment } from "@/features/experiments/engine";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ExperimentsPage() {
  const experiments = listExperiments();
  return (
    <div>
      <PageHeader
        title="Experimentos"
        description="Uma variável por vez, com grupo de controle e tamanho mínimo de amostra. Nada de declarar vencedor cedo — o painel mostra os dados; a variante campeã é escalada gradualmente dentro dos limites aprovados."
      />
      {experiments.length === 0 ? (
        <EmptyState title="Nenhum experimento" description="Crie um experimento (ex.: estilo de abertura) para começar a otimizar." />
      ) : (
        <div className="space-y-4">
          {experiments.map((exp) => {
            const summary = summarizeExperiment(exp.id);
            if (!summary) return null;
            return (
              <Card key={exp.id}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">{exp.name}</h2>
                    <div className="text-xs text-[var(--muted)]">Variável: {exp.variable}</div>
                  </div>
                  <Badge tone={summary.reachedMinSample ? "ok" : "warn"}>
                    {summary.reachedMinSample ? "Amostra mínima atingida" : `Amostra insuficiente (mín. ${exp.minSampleSize})`}
                  </Badge>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-[var(--muted)]">
                    <tr>
                      <th className="py-1">Variante</th>
                      <th className="py-1">Amostra</th>
                      <th className="py-1">Responderam</th>
                      <th className="py-1">Interessados+</th>
                      <th className="py-1">Conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.variants.map((v) => (
                      <tr key={v.variantId} className="border-t border-[var(--border)]">
                        <td className="py-1.5">
                          {v.key} {v.isControl ? <Badge>controle</Badge> : null}
                        </td>
                        <td className="py-1.5">{v.assigned}</td>
                        <td className="py-1.5">{v.replied}</td>
                        <td className="py-1.5">{v.interestedOrBeyond}</td>
                        <td className="py-1.5 font-medium">{(v.conversionRate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
