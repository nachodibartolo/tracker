// Free-text handler wired to the agent.
//
// The agent owns all AI decisions (create movements, query data, etc.).
// Maintenance and ambiguous-input replies live here.

import { InlineKeyboard, type Bot, type Context, type NextFunction } from "grammy";

import { AgentQuotaError, runExpenseAgent } from "@/lib/ai/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const GENERIC_ERROR = "Algo falló procesando tu mensaje. Probá de nuevo.";
const QUOTA_ERROR =
  "Mi cuota AI llegó al límite de hoy. Probá mañana o usá /saldo y /ultimos.";

export function registerTextHandler(bot: Bot): void {
  bot.on("message:text", handleText);
}

async function handleText(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (!from || !chat || !message || !message.text) {
    return next();
  }

  const commandEntities = ctx.entities("bot_command");

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured || !process.env.TELEGRAM_BOT_TOKEN) {
    if (commandEntities.length === 0) {
      await ctx.reply(MAINTENANCE_TEXT);
    }
    return next();
  }

  if (commandEntities.length > 0) {
    return next();
  }

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }

  try {
    const supabase = createAdminClient();
    const out = await runExpenseAgent({
      supabase,
      userId: linked.user_id,
      chatId: chat.id,
      mainCurrency: linked.main_currency,
      text: message.text,
    });
    await ctx.reply(out.text);
  } catch (err) {
    if (err instanceof AgentQuotaError) {
      await ctx.reply(QUOTA_ERROR);
      return;
    }
    console.error("[telegram/text] agent error", err);
    await ctx.reply(GENERIC_ERROR);
  }
}

// =============================================================================
// Legacy export — used by `confirm.ts` to rebuild the 3-button keyboard when
// the user taps "Editar" on a pending row from the OLD single-item flow.
// `confirm.ts` is dead code scheduled for removal in a follow-up PR.
// =============================================================================

/** Build the standard 3-button confirm/edit/cancel keyboard (legacy single-item flow). */
export function buildConfirmKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirmar", `confirm:${pendingId}`)
    .text("✏️ Editar", `edit:${pendingId}`)
    .text("❌ Cancelar", `cancel:${pendingId}`);
}
