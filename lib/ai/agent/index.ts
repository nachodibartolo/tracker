// lib/ai/agent/index.ts
import { generateText, stepCountIs } from "ai";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { gemma4, requireGoogleAi } from "./provider";
import { buildSystemPrompt, currentDateContext } from "./prompts";
import { buildTools } from "./tools";

type AdminClient = SupabaseClient<Database>;

export interface RunAgentInput {
  supabase: AdminClient;
  userId: string;
  chatId: number;
  mainCurrency: string;
  text?: string;
  image?: { data: Uint8Array; mimeType: string };
}

const FALLBACK_REPLY =
  "No pude procesar tu mensaje. Probá de nuevo o mandalo distinto.";

export class AgentQuotaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentQuotaError";
  }
}

export async function runExpenseAgent(
  input: RunAgentInput,
): Promise<{ text: string }> {
  requireGoogleAi();

  const dateCtx = currentDateContext();
  const system = buildSystemPrompt({ ...dateCtx, mainCurrency: input.mainCurrency });
  const tools = buildTools({
    supabase: input.supabase,
    userId: input.userId,
    chatId: input.chatId,
    mainCurrency: input.mainCurrency,
  });

  const userParts: (
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  )[] = [];
  if (input.image) {
    userParts.push({
      type: "image",
      image: input.image.data,
      mediaType: input.image.mimeType,
    });
  }
  if (input.text && input.text.length > 0) {
    userParts.push({ type: "text", text: input.text });
  }
  if (userParts.length === 0) {
    return { text: FALLBACK_REPLY };
  }

  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: gemma4,
      system,
      messages: [{ role: "user", content: userParts }],
      tools,
      stopWhen: stepCountIs(5),
      toolChoice: "auto",
      temperature: 0,
      onStepFinish: ({ toolCalls, stepType }) => {
        for (const tc of toolCalls ?? []) {
          console.info("[agent/step]", {
            user_id: input.userId,
            chat_id: input.chatId,
            step_type: stepType,
            tool_name: tc.toolName,
            ms_elapsed: Date.now() - startedAt,
          });
        }
      },
    });
    const text = result.text?.trim();
    if (!text || text.length === 0) {
      return { text: FALLBACK_REPLY };
    }
    return { text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/quota|rate.?limit|429/i.test(msg)) {
      throw new AgentQuotaError("Quota Gemma agotada", { cause: err });
    }
    throw err;
  }
}
