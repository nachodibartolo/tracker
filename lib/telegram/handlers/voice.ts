// Voice / audio handler — batch flow.
//
// Registers against BOTH `message:voice` (mic note, .ogg/opus) and
// `message:audio` (uploaded files, mime varies). Audio uploads can carry a
// caption; we pass it to the wallet resolver. Voice notes have no caption,
// so wallet resolution falls back to default.

import type { Bot, Context } from "grammy";

import { AiExtractionError, extractBatchFromAudio } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { deduplicateBatch } from "@/lib/telegram/dedup";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import {
  applyDedupFlags,
  attachMessageIdToBatch,
  insertPendingBatch,
} from "@/lib/telegram/pending-batch";
import { fetchTelegramFile } from "@/lib/telegram/storage-helpers";
import { resolveWalletFromCaption } from "@/lib/telegram/wallet-resolver";

import { renderBatchPreview } from "./batch";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No entendí el audio. Probá grabándolo de nuevo.";
const GENERIC_ERROR = "Algo falló procesando el audio. Probá de nuevo.";

const MIN_CONFIDENCE = 0.4;

export function registerVoiceHandler(bot: Bot): void {
  bot.on(["message:voice", "message:audio"], handleVoice);
}

async function handleVoice(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (!from || !chat || !message) return;

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured || !process.env.TELEGRAM_BOT_TOKEN) {
    await ctx.reply(MAINTENANCE_TEXT);
    return;
  }

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }

  const fileId = message.voice?.file_id ?? message.audio?.file_id ?? null;
  const mimeType =
    message.voice?.mime_type ?? message.audio?.mime_type ?? "audio/ogg";
  if (!fileId) return;

  let bytes: Uint8Array;
  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) throw new Error("Telegram returned no file_path");
    bytes = await fetchTelegramFile(file.file_path);
  } catch (err) {
    console.error("[telegram/voice] download failed", err);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  let batch;
  try {
    batch = await extractBatchFromAudio(
      { data: bytes, mimeType },
      linked.main_currency,
    );
  } catch (err) {
    if (err instanceof AiExtractionError) {
      console.error("[telegram/voice] AI extraction failed", err);
    } else {
      console.error("[telegram/voice] unexpected extractor error", err);
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

  const supabase = createAdminClient();
  const walletRes = await resolveWalletFromCaption(
    supabase,
    linked.user_id,
    message.caption ?? null,
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
    source: "telegram_audio",
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
