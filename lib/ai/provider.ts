import { google } from "@ai-sdk/google";

/**
 * Gemini Flash 2.5 — fast, multimodal (text, vision, audio) model used by the
 * expense extractor. The API key is auto-read from
 * `process.env.GOOGLE_GENERATIVE_AI_API_KEY` by `@ai-sdk/google`.
 */
export const geminiFlash = google("gemini-2.5-flash");

/**
 * Fail-fast guard for extraction entry points. Surfaces a clear error during
 * pre-provisioning dev instead of letting the SDK throw a generic 401.
 */
export function requireGoogleAi(): void {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env.local before calling the AI extractors.",
    );
  }
}
