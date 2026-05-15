import { google } from "@ai-sdk/google";

/**
 * Gemma 4 (26B MoE, 4B active) via the Gemini API. Free tier is 1500 RPD.
 * Trade-off vs Gemini 2.5 Flash: higher TTFB and slightly weaker tool-
 * calling, but a more generous per-minute rate cap — useful while the
 * Siri Shortcut path is being exercised and a single bursty user can
 * hit Gemini's per-minute limits during testing. Text + image only;
 * hosted Gemma variants do not support audio.
 *
 * Reads `GOOGLE_GENERATIVE_AI_API_KEY` from env automatically.
 */
export const agentModel = google("gemma-4-26b-a4b-it");

export function requireGoogleAi(): void {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env.local before calling the agent.",
    );
  }
}
