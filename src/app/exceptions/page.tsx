import { listExceptions } from "@/features/exceptions/repo";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/i18n";
import { resolveExceptionAction } from "../actions";

export const dynamic = "force-dynamic";

export default function ExceptionsPage() {
  const open = listExceptions("open");
  return (
    <div>
      <PageHeader
        title="Fila de exceções"
        description="Tudo que exige atenção humana ou nova tentativa segura: falhas de envio, janela da API fechada, indisponibilidade do navegador, violação de alegação, estouro de orçamento, jobs descartados."
      />
      {open.length === 0 ? (
        <EmptyState title="Nenhuma exceção aberta" description="O sistema está operando dentro dos limites." />
      ) : (
        <div className="space-y-3">
          {open.map((exc) => (
            <Card key={exc.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone="danger">{exc.type}</Badge>
                    <span className="text-xs text-[var(--muted)]">{formatDateTime(exc.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-sm">{exc.reason}</div>
                  {exc.leadId ? <div className="mt-1 text-xs text-[var(--muted)]">Lead: {exc.leadId}</div> : null}
                </div>
                <form action={resolveExceptionAction}>
                  <input type="hidden" name="id" value={exc.id} />
                  <button className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-sm hover:bg-[var(--border)]">
                    Resolver
                  </button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
