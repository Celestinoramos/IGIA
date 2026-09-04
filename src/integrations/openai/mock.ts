import type { BusinessConfig } from "@/config/business";
import type { Intent } from "@/features/conversations/intents";
import type { ConversationContext, Decision } from "./types";

/**
 * Deterministic, network-free engine used when OPENAI_API_KEY is absent (local
 * dev, CI, demos). It mirrors the real engine's contract: classify intent, then
 * decide an action + PT-BR message drawn only from verified claims.
 */

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function mockClassify(inboundText: string): Intent {
  const t = normalize(inboundText);
  if (/\b(parar|pare|nao quero mais|descadastr|sair da lista|remover|nao me chame)\b/.test(t)) return "opt_out";
  if (/\b(preco|valor|quanto custa|quanto e|taxa|taxas|mensalidade)\b/.test(t)) return "asked_pricing";
  if (/\b(whats|whatsapp|zap|me chama no)\b/.test(t)) return "wants_whatsapp";
  if (/\b(nao sou o dono|sou funcionari|quem cuida|o dono e|a dona e|responsavel e)\b/.test(t)) return "not_the_owner";
  if (/\b(vou passar|encaminho|repasso|falar com|mando para)\b/.test(t)) return "will_forward";
  if (/\b(caro|nao confio|golpe|receio|medo|ja tenho|nao preciso agora)\b/.test(t)) return "objection";
  if (/\b(nao tenho interesse|nao quero|nao obrigad)\b/.test(t)) return "not_interested";
  if (/\b(tenho interesse|me interessa|quero saber mais|bora|vamos|topo|gostei)\b/.test(t)) return "interested";
  if (/\b(como funciona|me explica|mais info|informacao|detalhes)\b/.test(t)) return "asked_info";
  if (t.trim().length === 0) return "ambiguous";
  return "ambiguous";
}

function firstVerified(config: BusinessConfig): string {
  return config.claims.verified[0] ?? config.offer.oneLinePitch;
}

export function mockDecide(context: ConversationContext, config: BusinessConfig): Decision {
  const intent = context.inboundText ? mockClassify(context.inboundText) : "ambiguous";
  const owner = config.owner.name;
  const company = config.company.name;
  const whatsapp = config.links.whatsapp;
  const affiliateGroup = config.links.affiliateGroup;
  const isAffiliate = context.lead.funnel === "affiliate";
  const forwardLink = isAffiliate ? affiliateGroup : whatsapp;

  switch (intent) {
    case "opt_out":
      return { intent, action: "close", message: "Sem problema, não te envio mais mensagens. Obrigada pela atenção!", reasoning: "Respect stop request immediately." };
    case "not_the_owner":
      return { intent, action: "ask", message: "Entendi! Você consegue me indicar quem cuida dessa parte? Prometo ser breve.", reasoning: "Ask for the decision maker." };
    case "will_forward":
      return { intent, action: "reply", message: "Perfeito, muito obrigada por repassar! Se preferir, posso mandar um resumo curtinho pra facilitar.", reasoning: "Thank and offer a summary." };
    case "asked_pricing":
      return { intent, action: "forward_whatsapp", message: `Ótima pergunta! As condições dependem do seu volume, então o ideal é a gente ver isso junto. Consigo te explicar certinho por aqui: ${forwardLink}`, reasoning: "Do not invent rates; move to WhatsApp for tailored info." };
    case "asked_info":
      return { intent, action: "present", message: `Claro! ${firstVerified(config)} Quem fala é ${owner}, da ${company}. Posso te contar como funciona em 1 minuto?`, reasoning: "Present with a verified claim." };
    case "interested":
      return { intent, action: "forward_whatsapp", message: `Que bom! Pra seguir do jeito certo, me chama aqui que eu te ajudo pessoalmente: ${forwardLink}`, reasoning: "Move an interested lead to WhatsApp / group." };
    case "wants_whatsapp":
      return { intent, action: "forward_whatsapp", message: `Combinado! É só me chamar por aqui: ${forwardLink}`, reasoning: "Lead asked for WhatsApp." };
    case "objection":
      return { intent, action: "handle_objection", message: `Entendo totalmente. ${firstVerified(config)} Sem compromisso: posso tirar suas dúvidas e você decide com calma. Faz sentido?`, reasoning: "Address objection with a verified claim, no pressure." };
    case "not_interested":
      return { intent, action: "close", message: "Sem problema, agradeço a sinceridade! Se um dia fizer sentido, é só me chamar. 🙌", reasoning: "Close politely." };
    case "needs_human":
      return { intent, action: "escalate_human", message: null, reasoning: "Requires a human." };
    case "ambiguous":
    default:
      return { intent: "ambiguous", action: "ask", message: "Oi! Só pra eu te entender melhor: você já usa algum meio pra receber pagamentos hoje?", reasoning: "Clarify with an open question." };
  }
}

export function mockOpener(context: ConversationContext, config: BusinessConfig): string {
  const name = context.lead.displayName?.split(" ")[0] ?? "";
  const greeting = name ? `Oi, ${name}!` : "Oi!";
  const niche = context.lead.niche ? ` do seu trabalho com ${context.lead.niche}` : " do seu perfil";
  if (context.lead.funnel === "affiliate") {
    return `${greeting} Curti bastante seu conteúdo${niche}. Sou ${config.owner.name}, da ${config.company.name}, e queria trocar uma ideia sobre uma parceria. Posso te contar rapidinho?`;
  }
  return `${greeting} Vi por aqui${niche} e achei bem bacana. Sou ${config.owner.name}, da ${config.company.name}. Posso te fazer uma pergunta rápida sobre pagamentos?`;
}
