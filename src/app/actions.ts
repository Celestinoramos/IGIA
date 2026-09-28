"use server";

import { revalidatePath } from "next/cache";
import { pauseSystem, resumeSystem } from "@/lib/system-state";
import { resolveException } from "@/features/exceptions/repo";
import type { Funnel } from "@/features/leads/states";
import { discoverLeads, type DiscoveryResult } from "@/features/campaigns/discovery";
import { parseLeadImport } from "@/features/campaigns/import";

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

export interface ImportLeadsState {
  status: "idle" | "ok" | "error";
  message?: string;
  result?: DiscoveryResult & { parsed: number };
  errors?: string[];
}

/**
 * Import the operator's lead list (pasted text or an uploaded CSV) into a
 * funnel: parse, dedupe, blocklist-check and ICP-score each profile, then queue
 * first contact for the qualified ones. The worker sends the DMs with pacing.
 */
export async function importLeadsAction(_prev: ImportLeadsState, formData: FormData): Promise<ImportLeadsState> {
  const funnel: Funnel = formData.get("funnel") === "affiliate" ? "affiliate" : "customer";
  const file = formData.get("file");
  const pasted = (formData.get("text") as string | null) ?? "";
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (!text.trim()) return { status: "error", message: "Cole a lista ou escolha um arquivo CSV." };

  const { profiles, errors } = parseLeadImport(text);
  if (profiles.length === 0) {
    return { status: "error", message: "Nenhum perfil válido encontrado.", errors };
  }
  const result = discoverLeads(funnel, profiles, {
    source: "import",
    qualifyAll: formData.get("qualifyAll") === "on",
  });
  revalidatePath("/", "layout");
  return { status: "ok", result: { ...result, parsed: profiles.length }, errors };
}
