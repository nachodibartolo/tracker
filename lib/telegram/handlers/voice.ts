// Voice / audio handler.
//
// We register against BOTH `message:voice` (the "hold-to-record" mic note,
// always .ogg/opus) and `message:audio` (uploaded music/podcast files —
// mime varies). Either way the flow is identical: download the bytes, hand
// them to the AI extractor, and persist a `telegram_pending` row.
//
// Unlike the photo flow we do NOT persist the audio: voice notes are
// considered ephemeral (the user already heard themselves saying it).
// If we ever want to keep them, the pattern from `photo.ts` carries over.

import type { Bot, Context } from "grammy";

import { AiExtractionError, extractFromAudio } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import { buildPreview } from "@/lib/telegram/preview";
import { fetchTelegramFile } from "@/lib/telegram/storage-helpers";

import { buildConfirmKeyboard, insertPending, loadWallet } from "./text";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No entendí el audio. Probá grabándolo de nuevo.";
const GENERIC_ERROR = "Algo falló procesando el audio. Probá de nuevo.";

const MIN_CONFIDENCE = 0.4;

export function registerVoiceHandler(bot: Bot): void {
  // Both filters point at the same handler. grammY treats this as a logical
  // OR — the handler fires for any update matching either filter.
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

  // Pick whichever attachment is present. Voice notes are .ogg/opus and
  // Telegram doesn't always set mime_type; we default to audio/ogg. For
  // uploaded audio files we honour the declared mime.
  const fileId =
    message.voice?.file_id ?? message.audio?.file_id ?? null;
  const mimeType =
    message.voice?.mime_type ??
    message.audio?.mime_type ??
    "audio/ogg";
  if (!fileId) {
    return;
  }

  // Fetch the bytes from the Telegram file endpoint.
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

  // Run the AI extraction. The provider may not support all audio mimes;
  // we let it fail and degrade with a generic error if so.
  let extraction;
  try {
    extraction = await extractFromAudio(
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

  if (extraction.type === "unknown" || extraction.confidence < MIN_CONFIDENCE) {
    await ctx.reply(NO_UNDERSTAND_TEXT);
    return;
  }

  const supabase = createAdminClient();

  const wallet = await loadWallet(supabase, linked.user_id, linked.default_wallet_id);
  if (!wallet) {
    await ctx.reply(NO_WALLET_TEXT);
    return;
  }

  const txType = extraction.type as "expense" | "income";
  const category = await resolveCategory(
    supabase,
    linked.user_id,
    txType,
    extraction.category_hint,
  );

  const { data: pending, error: pendingError } = await insertPending(
    supabase,
    linked.user_id,
    chat.id,
    extraction,
    wallet.id,
    category.id,
    "telegram_audio",
    null,
  );
  if (pendingError || !pending) {
    console.error("[telegram/voice] pending insert failed", pendingError);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  const preview = buildPreview(
    extraction,
    wallet.name,
    wallet.currency,
    category.label,
    false,
    "telegram_audio",
  );

  await ctx.reply(preview.text, {
    parse_mode: preview.markdown,
    reply_markup: buildConfirmKeyboard(pending.id),
  });
}
