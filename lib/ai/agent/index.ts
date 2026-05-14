// lib/ai/agent/index.ts
import { generateText, stepCountIs } from "ai";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { agentModel, requireGoogleAi } from "./provider";
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
  /**
   * If the user does not specify a wallet in their text, the agent uses
   * this UUID. Only set by the voice endpoint today; the Telegram handler
   * leaves it unset (preserves current behavior).
   */
  defaultWalletId?: string;
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
  const system = buildSystemPrompt({
    ...dateCtx,
    mainCurrency: input.mainCurrency,
    defaultWalletId: input.defaultWalletId,
  });
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
      model: agentModel,
      system,
      messages: [{ role: "user", content: userParts }],
      tools,
      // Most user intents resolve in 2 steps (decide tool → write response).
      // Cap at 3 to bound worst-case latency under Gemma free-tier slowness.
      stopWhen: stepCountIs(3),
      toolChoice: "auto",
      temperature: 0,
      // Default is 2 retries with exponential backoff; under free-tier rate
      // limits that compounds badly. Fail fast and surface the quota error.
      maxRetries: 1,
      onStepFinish: ({ toolCalls }) => {
        for (const tc of toolCalls ?? []) {
          console.info("[agent/step]", {
            user_id: input.userId,
            chat_id: input.chatId,
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
