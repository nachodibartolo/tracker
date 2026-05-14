import { google } from "@ai-sdk/google";

/**
 * Gemini 2.5 Flash. Lower TTFB and better tool-calling than the Gemma
 * variant we used initially; same free tier (15 RPM, 1500 RPD). Text +
 * image; audio is not used by the Telegram pipeline today.
 *
 * Reads `GOOGLE_GENERATIVE_AI_API_KEY` from env automatically.
 */
export const agentModel = google("gemini-2.5-flash");

export function requireGoogleAi(): void {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env.local before calling the agent.",
    );
  }
}
