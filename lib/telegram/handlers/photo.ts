// Photo handler — receipt OCR via the AI core.
//
// Flow:
//   1. `ctx.message.photo[]` is sorted small → large. We always pick the
//      largest so the model has the best chance at reading the total.
//   2. `getFile(file_id)` → Telegram returns a temporary `file_path`. We
//      fetch the bytes ourselves; they live ~1h.
//   3. Persist the JPEG to `receipts/<user_id>/<uuid>.jpg` via the admin
//      client so the user can view the receipt later in the web app.
//   4. Run `extractFromImage(...)` against the freshly-downloaded bytes.
//   5. Persist the pending suggestion + reply with the standard preview.
//
// We intentionally do the upload BEFORE the AI call so a successful upload
// guarantees the receipt is on storage even if the model times out.

import type { Bot, Context } from "grammy";

import { AiExtractionError, extractFromImage } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import { buildPreview } from "@/lib/telegram/preview";
import {
  fetchTelegramFile,
  uploadReceiptToStorage,
} from "@/lib/telegram/storage-helpers";

import { buildConfirmKeyboard, insertPending, loadWallet } from "./text";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No pude leer el ticket. Probá con otra foto.";
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

  // Pick the largest available size — Telegram returns an array sorted
  // ascending by dimensions.
  const largest = message.photo[message.photo.length - 1];
  if (!largest?.file_id) {
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  // Fetch the file from Telegram. `ctx.api.getFile` returns a `file_path`
  // we feed to the HTTPS file endpoint via `fetchTelegramFile`.
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

  // Upload to the `receipts` bucket BEFORE running AI so we still have the
  // file even if extraction fails (lets the user retry against a stored
  // image later). Failure here is fatal; we don't want orphaned pending
  // rows pointing at non-existent objects.
  let photoPath: string;
  try {
    photoPath = await uploadReceiptToStorage(linked.user_id, bytes, "jpg");
  } catch (err) {
    console.error("[telegram/photo] storage upload failed", err);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  // Run the AI extraction. We can pass the already-downloaded bytes — no
  // need to fetch twice.
  let extraction;
  try {
    extraction = await extractFromImage(
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

  // Photos are always expenses in practice (receipts). If the model came
  // back with `income`, respect it — it's a rare edge case we shouldn't
  // override silently.
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
    "telegram_photo",
    photoPath,
  );
  if (pendingError || !pending) {
    console.error("[telegram/photo] pending insert failed", pendingError);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  const preview = buildPreview(
    extraction,
    wallet.name,
    wallet.currency,
    category.label,
    true,
    "telegram_photo",
  );

  await ctx.reply(preview.text, {
    parse_mode: preview.markdown,
    reply_markup: buildConfirmKeyboard(pending.id),
  });
}
