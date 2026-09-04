import { getEnv } from "@/config/env";
import { loadBusinessConfig } from "@/config/business";
import { getPauseState } from "@/lib/system-state";
import { PageHeader, Card, Badge } from "@/components/ui";
import { formatUsd } from "@/lib/i18n";
import { PauseControl } from "@/components/PauseControl";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const env = getEnv();
  const config = loadBusinessConfig();
  const pause = getPauseState();

  const integrations = [
    { name: "OpenAI", ok: Boolean(env.OPENAI_API_KEY), detail: env.OPENAI_API_KEY ? `Modelo ${env.OPENAI_MODEL} / ${env.OPENAI_MODEL_FAST}` : "Sem chave — usando motor simulado (custo $0)" },
    { name: "Navegador (CDP)", ok: env.BROWSER_DRIVER === "real", detail: env.BROWSER_DRIVER === "real" ? `CDP: ${env.CHROME_CDP_URL}` : "Modo simulado (container/CI)" },
    { name: "API Instagram", ok: Boolean(env.INSTAGRAM_PAGE_ACCESS_TOKEN), detail: env.INSTAGRAM_PAGE_ACCESS_TOKEN ? "Token configurado" : "Sem token — envios pela API são simulados" },
    { name: "Webhook", ok: Boolean(env.INSTAGRAM_APP_SECRET && env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN), detail: env.INSTAGRAM_APP_SECRET ? "Assinatura verificável" : "App secret ausente" },
  ];

  return (
    <div>
      <PageHeader title="Configurações" description="Limites operacionais, integrações e controle de pausa. Segredos e limites vêm do .env; identidade do negócio vem de config/business.json." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Limites operacionais</h2>
          <dl className="space-y-2 text-sm">
            <Row label="DMs por dia (máx.)" value={String(env.MAX_DMS_PER_DAY)} />
            <Row label="Intervalo entre DMs" value={`${env.MIN_SECONDS_BETWEEN_DMS}–${env.MAX_SECONDS_BETWEEN_DMS}s`} />
            <Row label="Janela de operação" value={`${env.OPERATING_HOURS} (${env.OPERATING_TIMEZONE})`} />
            <Row label="Orçamento OpenAI/mês" value={formatUsd(env.OPENAI_MONTHLY_BUDGET_USD)} />
            <Row label="Dry-run (não envia de fato)" value={env.DRY_RUN ? "Sim" : "Não"} />
          </dl>
          <p className="mt-3 text-xs text-[var(--muted)]">
            Estes valores são editados no arquivo <code>.env</code> e recarregados ao reiniciar. Ajustes de prompts, critérios, pontuações e horários dentro dos limites aprovados podem ser feitos pela IA automaticamente.
          </p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Integrações</h2>
          <div className="space-y-2">
            {integrations.map((it) => (
              <div key={it.name} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{it.name}</div>
                  <div className="text-xs text-[var(--muted)]">{it.detail}</div>
                </div>
                <Badge tone={it.ok ? "ok" : "warn"}>{it.ok ? "Ativo" : "Simulado/Pendente"}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Identidade do negócio</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Empresa" value={config.company.name} />
            <Row label="Responsável" value={`${config.owner.name} — ${config.owner.role}`} />
            <Row label="Instagram" value={config.company.instagramHandle} />
            <Row label="Geografia" value={config.geography} />
          </dl>
          <div className="mt-3">
            <div className="text-xs font-medium text-[var(--muted)]">Afirmações verificadas (únicas permitidas):</div>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {config.claims.verified.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs font-medium text-[var(--muted)]">Afirmações bloqueadas (até virarem prova):</div>
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-300/80">
              {config.claims.unverified.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Controle de pausa</h2>
          <p className="mb-3 text-xs text-[var(--muted)]">
            O botão de pausa geral interrompe imediatamente toda a prospecção. O sistema também pausa sozinho diante de risco (indisponibilidade do navegador, estouro de orçamento, pico de erros, etc.).
          </p>
          <PauseControl />
          {pause.paused ? <div className="mt-2 text-xs text-red-300">Pausado desde {new Date(pause.since ?? 0).toLocaleString("pt-BR")}.</div> : null}
        </Card>
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
