import { google } from "@ai-sdk/google";

/**
 * Gemma 4 (26B MoE, 4B active) via the Gemini API. Text + image only; the
 * hosted Gemma variants do not support audio. Free tier is 1500 RPD.
 *
 * Reads `GOOGLE_GENERATIVE_AI_API_KEY` from env automatically.
 */
export const gemma4 = google("gemma-4-26b-a4b-it");

export function requireGoogleAi(): void {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env.local before calling the agent.",
    );
  }
}
