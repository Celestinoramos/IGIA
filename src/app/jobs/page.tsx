import { listJobs } from "@/worker/queue";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import { JOB_STATUS_LABELS, formatDateTime } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const jobs = listJobs(200);
  return (
    <div>
      <PageHeader title="Fila de jobs" description="Jobs duráveis do worker: descoberta, primeiro contato, processamento de respostas, follow-ups e backup." />
      {jobs.length === 0 ? (
        <EmptyState title="Nenhum job na fila" />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)] text-left text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Tentativas</th>
                <th className="px-4 py-2">Executar em</th>
                <th className="px-4 py-2">Último erro</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 font-medium">{job.type}</td>
                  <td className="px-4 py-2">
                    <Badge tone={job.status === "dead" ? "danger" : job.status === "failed" ? "warn" : job.status === "succeeded" ? "ok" : "neutral"}>
                      {JOB_STATUS_LABELS[job.status] ?? job.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">{job.attempts}/{job.maxAttempts}</td>
                  <td className="px-4 py-2 text-[var(--muted)]">{formatDateTime(job.runAt)}</td>
                  <td className="px-4 py-2 text-xs text-[var(--muted)]">{job.lastError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
