import OpenAI from "openai";
import { getEnv } from "@/config/env";

let client: OpenAI | null = null;

/** Lazily create the OpenAI client. Returns null when no key is configured. */
export function getOpenAiClient(): OpenAI | null {
  const key = getEnv().OPENAI_API_KEY;
  if (!key) return null;
  if (!client) client = new OpenAI({ apiKey: key });
  return client;
}

export function hasOpenAi(): boolean {
  return Boolean(getEnv().OPENAI_API_KEY);
}
