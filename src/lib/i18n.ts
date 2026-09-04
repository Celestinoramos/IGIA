import type { PipelineState, ChannelState } from "@/features/leads/states";

/** Internal English values → PT-BR labels for the operator interface. */
export const PIPELINE_LABELS: Record<PipelineState, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  whatsapp_handoff: "Encaminhado ao WhatsApp",
  registered: "Cadastrado",
  active_customer: "Cliente ativo",
  joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente",
  closed: "Encerrado",
};

export const CHANNEL_LABELS: Record<ChannelState, string> = {
  browser_contact_pending: "Navegador — pendente",
  browser_contact_sent: "Navegador — enviado",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "API — elegível",
  api_active: "API — ativa",
  api_window_closed: "API — janela fechada",
  human_review_required: "Revisão humana",
  do_not_contact: "Não contatar",
  blocked: "Bloqueado",
  completed: "Concluído",
};

export const FUNNEL_LABELS: Record<string, string> = {
  customer: "Clientes",
  affiliate: "Afiliados",
};

export const PROFILE_TYPE_LABELS: Record<string, string> = {
  store: "Loja",
  employee: "Funcionário",
  owner: "Dono",
  decision_maker: "Decisor",
  creator: "Criador",
  unknown: "Indefinido",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  running: "Em execução",
  succeeded: "Concluído",
  failed: "Falhou",
  dead: "Descartado",
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function formatUsd(value: number): string {
  return currency.format(value);
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return dateTime.format(new Date(ms));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
