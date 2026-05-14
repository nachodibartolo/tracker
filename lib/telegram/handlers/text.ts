// Free-text handler con batch + interceptor de modo exclude/transfer.
//
// Flujo:
//   1. Si hay un "modo" activo en telegram_chat_state (exclude/transfer),
//      el mensaje se interpreta como input de ese modo y NO se corre AI.
//   2. Sino, fluye al extractor batch.
//
// "Modo exclusión": mensaje debe ser CSV de números o "/cancel".
// "Modo transfer": el usuario tapea botones inline; cualquier otro texto
//                  se ignora (mandar /listo o /cancel sale del modo).

import { InlineKeyboard, type Bot, type Context, type NextFunction } from "grammy";

import { AiExtractionError, extractBatchFromText } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { clearAwaiting, getActiveAwaiting } from "@/lib/telegram/chat-state";
import { deduplicateBatch } from "@/lib/telegram/dedup";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import {
  applyDedupFlags,
  attachMessageIdToBatch,
  excludeIndices,
  insertPendingBatch,
} from "@/lib/telegram/pending-batch";
import { resolveWalletFromCaption } from "@/lib/telegram/wallet-resolver";

import { renderBatchPreview } from "./batch";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No entendí. Probá: 'gasté 200 en almuerzo'";
const GENERIC_ERROR = "Algo falló procesando tu mensaje. Probá de nuevo.";

const MIN_CONFIDENCE = 0.4;

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

  const supabase = createAdminClient();

  // --- Mode interception (exclude / transfer) ---
  const awaiting = await getActiveAwaiting(supabase, chat.id);
  if (awaiting) {
    const text = message.text.trim();
    if (text === "/cancel" || text === "/listo") {
      await clearAwaiting(supabase, chat.id);
      await ctx.reply("Listo, volvé a tapear botones del preview.");
      return;
    }
    if (awaiting.mode === "exclude") {
      const parsed = /^[\d,\s]+$/.test(text)
        ? text
            .split(",")
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => Number.isInteger(n) && n > 0)
            .map((n) => n - 1)
        : null;
      if (!parsed || parsed.length === 0) {
        await ctx.reply("No entendí. Mandá ej: 3,7,12 o /cancel.");
        return;
      }
      const result = await excludeIndices(supabase, awaiting.batchId, parsed);
      await clearAwaiting(supabase, chat.id);

      const excludedHuman = result.excluded.map((i) => i + 1).join(",");
      const notFoundHuman = result.notFound.map((i) => i + 1).join(",");
      const lines: string[] = [];
      if (excludedHuman) lines.push(`✏️ Excluí: ${excludedHuman}.`);
      if (notFoundHuman) lines.push(`No existen: ${notFoundHuman}.`);
      if (lines.length === 0) lines.push("Nada que excluir.");
      await ctx.reply(lines.join(" "));
      await renderBatchPreview(ctx, supabase, awaiting.batchId, chat.id);
      return;
    }
    // mode === 'transfer': free text not interpreted; user uses inline kbd.
    await ctx.reply("Tapeá los botones para asignar wallet contraparte, o mandame /listo.");
    return;
  }

  // --- Comandos pasan al chain ---
  if (commandEntities.length > 0) {
    return next();
  }

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }

  let batch;
  try {
    batch = await extractBatchFromText(message.text, linked.main_currency);
  } catch (err) {
    if (err instanceof AiExtractionError) {
      console.error("[telegram/text] AI extraction failed", err);
    } else {
      console.error("[telegram/text] unexpected extractor error", err);
    }
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  const validItems = batch.items.filter(
    (i) =>
      i.type !== "unknown" &&
      i.amount !== null &&
      i.amount > 0 &&
      i.confidence >= MIN_CONFIDENCE,
  );
  if (validItems.length === 0) {
    await ctx.reply(NO_UNDERSTAND_TEXT);
    return;
  }

  const walletRes = await resolveWalletFromCaption(
    supabase,
    linked.user_id,
    null,
    linked.default_wallet_id,
  );
  if (walletRes.kind === "none") {
    await ctx.reply(NO_WALLET_TEXT);
    return;
  }

  const itemsForInsert = await Promise.all(
    validItems.map(async (item) => {
      const cat = await resolveCategory(
        supabase,
        linked.user_id,
        item.type === "income" ? "income" : "expense",
        item.category_hint,
        item.subcategory_hint,
      );
      return { item, categoryId: cat.id, photoPath: null };
    }),
  );

  const walletId = walletRes.kind === "resolved" ? walletRes.wallet.id : null;

  const inserted = await insertPendingBatch(supabase, {
    userId: linked.user_id,
    telegramChatId: chat.id,
    source: "telegram_text",
    walletId,
    items: itemsForInsert,
  });
  if (!inserted) {
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  if (walletRes.kind === "resolved") {
    const dedup = await deduplicateBatch(
      supabase,
      linked.user_id,
      walletRes.wallet.id,
      validItems,
      inserted.batchId,
    );
    await applyDedupFlags(supabase, inserted.batchId, dedup);
    const lastMessageId = await renderBatchPreview(ctx, supabase, inserted.batchId, chat.id);
    if (lastMessageId) {
      await attachMessageIdToBatch(supabase, inserted.batchId, lastMessageId);
    }
  } else {
    const keyboard = {
      inline_keyboard: walletRes.candidates.map((w) => [
        { text: w.name, callback_data: `bwallet:${inserted.batchId}:${w.id}` },
      ]),
    };
    const reply = await ctx.reply(
      `📋 Encontré ${validItems.length} ${validItems.length === 1 ? "movimiento" : "movimientos"}. ¿A qué wallet van?`,
      { reply_markup: keyboard },
    );
    await attachMessageIdToBatch(supabase, inserted.batchId, reply.message_id);
  }
}

// =============================================================================
// Legacy export — used by `confirm.ts` to rebuild the 3-button keyboard when
// the user taps "Editar" on a pending row from the OLD single-item flow.
// New batch flow uses inline keyboards built inside `batch.ts`.
// =============================================================================

/** Build the standard 3-button confirm/edit/cancel keyboard (legacy single-item flow). */
export function buildConfirmKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirmar", `confirm:${pendingId}`)
    .text("✏️ Editar", `edit:${pendingId}`)
    .text("❌ Cancelar", `cancel:${pendingId}`);
}
