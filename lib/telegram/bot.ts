// Singleton grammY bot instance + handler registration.
//
// We instantiate the bot lazily-ish: the token is read at module load. When
// `TELEGRAM_BOT_TOKEN` is missing (pre-Wave-6 dev / CI), the constructor would
// throw, so the webhook route short-circuits BEFORE importing this module.
// See `app/api/telegram/webhook/route.ts` for that guard.
//
// Handler registration is centralized in `registerHandlers(bot)` (re-exported
// from this file via `lib/telegram/handlers/index.ts`). The registration is
// idempotent: a module-level `__registered` flag ensures we don't double-wire
// handlers if the route's hot-reload re-imports the bot in dev. Wave 4C adds
// AI handlers (text / photo / voice / confirm) — they MUST be spliced in
// BEFORE the final catch-all in `registerHandlers`.

import { Bot } from "grammy";

import { registerHandlers as _registerHandlers } from "@/lib/telegram/handlers";

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN ?? "missing");

let __registered = false;

/**
 * Wires all command + message handlers onto the bot. Safe to call multiple
 * times — only the first call actually registers. Wave 4C extends
 * `lib/telegram/handlers/index.ts`, not this file.
 */
export function registerHandlers(): void {
  if (__registered) return;
  _registerHandlers(bot);
  __registered = true;
}

let __initPromise: Promise<void> | null = null;

/**
 * Ensures the bot has called `getMe` once so `bot.handleUpdate()` works.
 * `webhookCallback` does this implicitly; we have to do it ourselves when
 * we hand updates to the bot directly. Cached per cold-start instance.
 */
export function ensureBotReady(): Promise<void> {
  if (!__initPromise) {
    __initPromise = bot.init().catch((err) => {
      // Reset on failure so the next request retries instead of permanently
      // returning a rejected promise.
      __initPromise = null;
      throw err;
    });
  }
  return __initPromise;
}

// Friendly error logging — Telegram retries failed webhooks, and silent errors
// would be hard to debug. We never throw out of a handler.
bot.catch((err) => {
  console.error("[telegram] handler error", err);
});
