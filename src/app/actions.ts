"use server";

import { revalidatePath } from "next/cache";
import { pauseSystem, resumeSystem } from "@/lib/system-state";
import { resolveException } from "@/features/exceptions/repo";
import { enqueue } from "@/worker/queue";
import type { Funnel } from "@/features/leads/states";
import type { PublicProfile } from "@/features/leads/scoring";

export async function pauseAction(formData: FormData): Promise<void> {
  const reason = (formData.get("reason") as string | null) ?? "operator_manual_pause";
  pauseSystem(reason, "operator");
  revalidatePath("/", "layout");
}

export async function resumeAction(): Promise<void> {
  resumeSystem("operator");
  revalidatePath("/", "layout");
}

export async function resolveExceptionAction(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (id) resolveException(id, "operator");
  revalidatePath("/exceptions");
}

/**
 * Simulate a discovery run for the given funnel using sample public profiles.
 * In production, candidates come from crawling public Instagram signals; the
 * worker will process the enqueued job (discover → qualify → first contact).
 */
export async function runDiscoveryAction(formData: FormData): Promise<void> {
  const funnel = ((formData.get("funnel") as string | null) ?? "customer") as Funnel;
  const stamp = Date.now();
  const customerSamples: PublicProfile[] = [
    { instagramHandle: `@loja_novidades_${stamp}`, displayName: "Loja Novidades", bio: "Loja de roupas femininas. Faça seu pedido no delivery!", followerCount: 5200, location: "São Paulo", hashtags: ["loja", "moda"] },
    { instagramHandle: `@hamburgueria_${stamp}`, displayName: "Burger House", bio: "Hamburgueria artesanal • delivery • dono João", followerCount: 9100, hashtags: ["delivery", "hamburgueria"] },
  ];
  const affiliateSamples: PublicProfile[] = [
    { instagramHandle: `@dicas_financas_${stamp}`, displayName: "Dicas de Finanças", bio: "Conteúdo de finanças e empreendedorismo para pequenos negócios", followerCount: 38000, hashtags: ["financas", "empreendedorismo"] },
  ];
  enqueue({
    type: "discover_leads",
    payload: { funnel, candidates: funnel === "customer" ? customerSamples : affiliateSamples },
  });
  revalidatePath("/", "layout");
}
