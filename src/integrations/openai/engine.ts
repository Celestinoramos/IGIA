import "server-only";
import type { BusinessConfig } from "@/config/business";
import { getEnv } from "@/config/env";
import { isIntent, isAction, type Intent } from "@/features/conversations/intents";
import { recordEvent } from "@/lib/observability";
import { logger } from "@/lib/logger";
import { openException } from "@/features/exceptions/repo";
import { getOpenAiClient } from "./client";
import { checkBudget, recordAiCall } from "./budget";
import { estimateTokens } from "./pricing";
import { checkClaims } from "./claims";
import { mockClassify, mockDecide, mockOpener } from "./mock";
import type { ConversationContext, Decision } from "./types";

export class BudgetExceededError extends Error {
  constructor() {
    super("OpenAI monthly budget exceeded");
    this.name = "BudgetExceededError";
  }
}

function systemPrompt(config: BusinessConfig): string {
  return [
    `Você é o assistente comercial de ${config.owner.name} (${config.owner.role}) da empresa ${config.company.name}.`,
    `Fale em português do Brasil, de forma pessoal e breve, como um SDR humano — nunca como uma campanha.`,
    `VOCÊ SÓ PODE AFIRMAR o que está na lista de afirmações verificadas abaixo. NUNCA invente taxa, condição, garantia, relação societária ou superlativo. NUNCA prometa aprovação de conta nem resultado financeiro.`,
    `Afirmações verificadas (as únicas permitidas):`,
    ...config.claims.verified.map((c) => `- ${c}`),
    `Proposta: ${config.offer.oneLinePitch}`,
    `Para interessados em pagamentos, encaminhe ao WhatsApp: ${config.links.whatsapp}`,
    `Para afiliados/criadores, encaminhe ao grupo: ${config.links.affiliateGroup}`,
  ].join("\n");
}

/** Whether the real OpenAI SDK is used or the deterministic mock. */
function shouldUseMock(): boolean {
  return getOpenAiClient() === null;
}

async function callChatJson(
  model: string,
  system: string,
  user: string,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const client = getOpenAiClient();
  if (!client) throw new Error("OpenAI client not configured");
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });
  const content = completion.choices[0]?.message?.content ?? "{}";
  return {
    content,
    promptTokens: completion.usage?.prompt_tokens ?? estimateTokens(system + user),
    completionTokens: completion.usage?.completion_tokens ?? estimateTokens(content),
  };
}

export async function classifyIntent(
  context: ConversationContext,
  leadId?: string,
): Promise<Intent> {
  if (!context.inboundText) return "ambiguous";
  const budget = checkBudget();
  if (!budget.withinBudget) throw new BudgetExceededError();

  if (shouldUseMock()) {
    const intent = mockClassify(context.inboundText);
    recordAiCall({
      leadId,
      purpose: "classify_intent",
      model: `${getEnv().OPENAI_MODEL_FAST}:mock`,
      promptTokens: estimateTokens(context.inboundText),
      completionTokens: 4,
      mock: true,
    });
    return intent;
  }

  const model = getEnv().OPENAI_MODEL_FAST;
  const user = `Classifique a intenção da mensagem recebida. Responda JSON {"intent": "..."} usando um destes valores: interested, asked_info, asked_pricing, wants_whatsapp, not_the_owner, will_forward, objection, not_interested, opt_out, ambiguous, needs_human.\nMensagem: """${context.inboundText}"""`;
  const res = await callChatJson(model, "Você classifica intenções de mensagens comerciais.", user);
  recordAiCall({ leadId, purpose: "classify_intent", model, promptTokens: res.promptTokens, completionTokens: res.completionTokens, mock: false });
  const parsed = safeParse(res.content);
  const value = typeof parsed.intent === "string" && isIntent(parsed.intent) ? parsed.intent : "ambiguous";
  return value;
}

export async function decideReply(
  context: ConversationContext,
  config: BusinessConfig,
  leadId?: string,
): Promise<Decision> {
  const budget = checkBudget();
  if (!budget.withinBudget) throw new BudgetExceededError();

  let decision: Decision;
  if (shouldUseMock()) {
    decision = mockDecide(context, config);
    recordAiCall({
      leadId,
      purpose: "decide_reply",
      model: `${getEnv().OPENAI_MODEL}:mock`,
      promptTokens: estimateTokens(JSON.stringify(context)),
      completionTokens: estimateTokens(decision.message ?? ""),
      mock: true,
    });
  } else {
    const model = getEnv().OPENAI_MODEL;
    const user = buildDecisionPrompt(context);
    const res = await callChatJson(model, systemPrompt(config), user);
    recordAiCall({ leadId, purpose: "decide_reply", model, promptTokens: res.promptTokens, completionTokens: res.completionTokens, mock: false });
    decision = parseDecision(res.content);
  }

  return enforceClaims(decision, config, leadId);
}

export async function draftOpener(
  context: ConversationContext,
  config: BusinessConfig,
  leadId?: string,
): Promise<string> {
  const budget = checkBudget();
  if (!budget.withinBudget) throw new BudgetExceededError();

  let message: string;
  if (shouldUseMock()) {
    message = mockOpener(context, config);
    recordAiCall({
      leadId,
      purpose: "draft_opener",
      model: `${getEnv().OPENAI_MODEL}:mock`,
      promptTokens: estimateTokens(JSON.stringify(context.lead)),
      completionTokens: estimateTokens(message),
      mock: true,
    });
  } else {
    const model = getEnv().OPENAI_MODEL;
    const signals = JSON.stringify(context.lead.publicSignals ?? {});
    const user = `Escreva uma abertura curta, pessoal e verdadeira (máx 300 caracteres) para o perfil @${context.lead.handle} (${context.lead.displayName ?? "sem nome"}), nicho: ${context.lead.niche ?? "desconhecido"}. Baseie-se nesses sinais públicos: ${signals}. Responda JSON {"message": "..."}.`;
    const res = await callChatJson(model, systemPrompt(config), user);
    recordAiCall({ leadId, purpose: "draft_opener", model, promptTokens: res.promptTokens, completionTokens: res.completionTokens, mock: false });
    const parsed = safeParse(res.content);
    message = typeof parsed.message === "string" ? parsed.message : mockOpener(context, config);
  }

  const check = checkClaims(message, config);
  if (!check.ok) {
    recordEvent({ type: "openai.claims_blocked", leadId, data: { where: "opener", violations: check.violations } });
    // Fall back to the safe, claim-free template opener.
    return mockOpener(context, config);
  }
  return message;
}

/** Reject drafts that violate claim rules; escalate to a human instead. */
function enforceClaims(decision: Decision, config: BusinessConfig, leadId?: string): Decision {
  if (!decision.message) return decision;
  const check = checkClaims(decision.message, config);
  if (check.ok) return decision;

  recordEvent({ type: "openai.claims_blocked", leadId, data: { violations: check.violations, action: decision.action } });
  openException({
    leadId: leadId ?? null,
    type: "claims_violation",
    reason: `Draft blocked: ${check.violations.join(", ")}`,
    data: { message: decision.message, violations: check.violations },
  });
  logger.warn("Claims guard blocked a draft; escalating to human", { leadId, violations: check.violations });
  return { intent: "needs_human", action: "escalate_human", message: null, reasoning: `claims_violation: ${check.violations.join(", ")}` };
}

function buildDecisionPrompt(context: ConversationContext): string {
  const history = context.history.map((h) => `${h.direction === "inbound" ? "Lead" : "Nós"}: ${h.body}`).join("\n");
  return [
    `Funil: ${context.lead.funnel}. Etapa: ${context.lead.pipelineState}. Tipo de perfil: ${context.lead.profileType}.`,
    `Histórico:\n${history || "(sem histórico)"}`,
    context.inboundText ? `Última mensagem do lead: """${context.inboundText}"""` : "",
    `Decida a próxima ação. Responda JSON {"intent": "...", "action": "...", "message": "...", "reasoning": "..."}.`,
    `intent ∈ {interested, asked_info, asked_pricing, wants_whatsapp, not_the_owner, will_forward, objection, not_interested, opt_out, ambiguous, needs_human}.`,
    `action ∈ {reply, ask, present, handle_objection, forward_whatsapp, wait, schedule_followup, close, escalate_human}.`,
    `message pode ser null quando a ação for wait/close/escalate_human sem texto.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function safeParse(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseDecision(content: string): Decision {
  const parsed = safeParse(content);
  const intent = typeof parsed.intent === "string" && isIntent(parsed.intent) ? parsed.intent : "ambiguous";
  const action = typeof parsed.action === "string" && isAction(parsed.action) ? parsed.action : "ask";
  const message = typeof parsed.message === "string" && parsed.message.trim().length > 0 ? parsed.message : null;
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
  return { intent, action, message, reasoning };
}
