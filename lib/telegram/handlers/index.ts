// Central registration point for all Telegram bot handlers.
//
// Order matters: grammY runs middleware top-to-bottom, and the first handler
// that does NOT call `next()` short-circuits the rest. The catch-all at the
// bottom must therefore stay last so specific commands win.
//
// Wave 3 (current) wires:
//   - /start [code]   — linking flow
//   - /saldo          — balance summary
//   - /ultimos        — last 5 transactions
//   - catch-all       — politely tells unlinked users to link first, or
//                       points linked users to the help text.
//
// Wave 4C splice point: text / photo / voice / confirmation handlers go
// IMMEDIATELY BEFORE `registerCatchAll(bot)` below. Add new `register*`
// functions in `lib/telegram/handlers/<name>.ts` and call them here. Do NOT
// move the catch-all.

import type { Bot } from "grammy";

import { getLinkedUser } from "@/lib/telegram/get-linked-user";

import { registerBatchHandler } from "./batch";
import { registerConfirmHandler } from "./confirm";
import { registerPhotoHandler } from "./photo";
import { registerStartHandler } from "./start";
import { registerStatusHandlers } from "./status";
import { registerTextHandler } from "./text";
import { registerUndoHandler } from "./undo";
import { registerVoiceHandler } from "./voice";

const ONBOARDING_TEXT =
  "Necesitás vincular tu cuenta primero. Andá a la app, generá un código en Ajustes → Telegram y mandámelo con `/start <codigo>`.";

const HELP_TEXT =
  "Comandos disponibles:\n" +
  "/saldo — ver el balance de tus wallets\n" +
  "/ultimos — ver tus últimas transacciones\n\n" +
  "Próximamente vas a poder mandarme un texto, una foto del recibo o un audio para registrar gastos.";

/**
 * Registers every handler on the supplied bot. Idempotent at the bot level
 * (grammY would happily register duplicates) — the caller in
 * `lib/telegram/bot.ts` guards with a module-level flag.
 */
export function registerHandlers(bot: Bot): void {
  // --- Wave 3 ---
  registerStartHandler(bot);
  registerStatusHandlers(bot);
  registerUndoHandler(bot);

  // --- Wave 4C + Wave 5 splice point ---
  // Order matters:
  //   - batch FIRST so `b*` callbacks are claimed before the legacy
  //     `confirm:/edit:/cancel:` matcher in confirm.ts.
  //   - confirm SECOND for any legacy single-item pending row still in flight.
  //   - photo / voice BEFORE text so media handlers claim media updates.
  //   - text LAST among the new handlers — it intercepts CSV exclusion and
  //     /cancel + /listo before falling through to the AI extractor.
  registerBatchHandler(bot);
  registerConfirmHandler(bot);
  registerPhotoHandler(bot);
  registerVoiceHandler(bot);
  registerTextHandler(bot);

  // --- Catch-all (KEEP LAST) ---
  registerCatchAll(bot);
}

function registerCatchAll(bot: Bot): void {
  // Match any message OR callback query that wasn't already handled above.
  // We intentionally avoid `bot.on(":text")` so that future media handlers
  // (photo, voice) can splice in before this without being shadowed.
  bot.on(["message", "callback_query"], async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    const linked = await getLinkedUser(from.id);
    if (!linked) {
      await ctx.reply(ONBOARDING_TEXT, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply(HELP_TEXT);
  });
}
