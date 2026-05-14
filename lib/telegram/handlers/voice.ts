// Voice handler — disabled in the Gemma 4 era.
//
// Gemma 4 hosted variants on Gemini API do not support audio. Self-hosting
// the E4B variant would break the $0/mes constraint. Instead of accepting
// voice messages and silently failing, we reply with a clear notice so the
// user knows to send text or a photo.

import type { Bot, Context } from "grammy";

import { getLinkedUser } from "@/lib/telegram/get-linked-user";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const DISABLED_TEXT =
  "Voice deshabilitado. Mandame el gasto por texto o sacale una foto al ticket.";

export function registerVoiceHandler(bot: Bot): void {
  bot.on(["message:voice", "message:audio"], handleVoice);
}

async function handleVoice(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }
  await ctx.reply(DISABLED_TEXT);
}
