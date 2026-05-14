// Photo handler — supports batch flow.
//
// El usuario puede mandar:
//   - una foto de recibo (1 movimiento) → preview con 1-item batch.
//   - un screenshot de bank statement / billetera (N movimientos).
//
// Caption opcional: nombre de wallet (ej "nacion"). Si no resuelve, se
// muestra un selector de wallet inline. La dedup corre después de saber la
// wallet target.

import type { Bot, Context } from "grammy";

import { AiExtractionError, extractBatchFromImage } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { deduplicateBatch } from "@/lib/telegram/dedup";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import {
  applyDedupFlags,
  attachMessageIdToBatch,
  insertPendingBatch,
} from "@/lib/telegram/pending-batch";
import {
  fetchTelegramFile,
  uploadReceiptToStorage,
} from "@/lib/telegram/storage-helpers";
import { resolveWalletFromCaption } from "@/lib/telegram/wallet-resolver";

import { renderBatchPreview } from "./batch";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No pude leer movimientos. Probá con otra foto.";
const GENERIC_ERROR = "Algo falló procesando la foto. Probá de nuevo.";

const MIN_CONFIDENCE = 0.4;

export function registerPhotoHandler(bot: Bot): void {
  bot.on("message:photo", handlePhoto);
}

async function handlePhoto(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (!from || !chat || !message || !message.photo || message.photo.length === 0) {
    return;
  }

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

  const largest = message.photo[message.photo.length - 1];
  if (!largest?.file_id) {
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  let bytes: Uint8Array;
  try {
    const file = await ctx.api.getFile(largest.file_id);
    if (!file.file_path) throw new Error("Telegram returned no file_path");
    bytes = await fetchTelegramFile(file.file_path);
  } catch (err) {
    console.error("[telegram/photo] download failed", err);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  let photoPath: string;
  try {
    photoPath = await uploadReceiptToStorage(linked.user_id, bytes, "jpg");
  } catch (err) {
    console.error("[telegram/photo] storage upload failed", err);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  let batch;
  try {
    batch = await extractBatchFromImage(
      { data: bytes, mimeType: "image/jpeg" },
      linked.main_currency,
    );
  } catch (err) {
    if (err instanceof AiExtractionError) {
      console.error("[telegram/photo] AI extraction failed", err);
    } else {
      console.error("[telegram/photo] unexpected extractor error", err);
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
      return { item, categoryId: cat.id, photoPath };
    }),
  );

  const walletId = walletRes.kind === "resolved" ? walletRes.wallet.id : null;

  const inserted = await insertPendingBatch(supabase, {
    userId: linked.user_id,
    telegramChatId: chat.id,
    source: "telegram_photo",
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
