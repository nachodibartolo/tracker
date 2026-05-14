// Photo handler wired to the agent.
//
// Downloads the photo, uploads it to storage so the agent can persist
// photo_path on each created row, then calls runExpenseAgent with the image
// bytes.

import type { Bot, Context } from "grammy";

import { AgentQuotaError, runExpenseAgent } from "@/lib/ai/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import {
  fetchTelegramFile,
  uploadReceiptToStorage,
} from "@/lib/telegram/storage-helpers";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const GENERIC_ERROR = "Algo falló procesando la foto. Probá de nuevo.";
const QUOTA_ERROR =
  "Mi cuota AI llegó al límite de hoy. Probá mañana o usá /saldo y /ultimos.";

export function registerPhotoHandler(bot: Bot): void {
  bot.on("message:photo", handlePhoto);
}

async function handlePhoto(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (
    !from ||
    !chat ||
    !message ||
    !message.photo ||
    message.photo.length === 0
  ) {
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

  try {
    const supabase = createAdminClient();
    // We pass photoPath via caption text so the agent can include it in
    // create_movements. The system prompt mentions this convention.
    const captionPart = message.caption ? `${message.caption}\n\n` : "";
    const out = await runExpenseAgent({
      supabase,
      userId: linked.user_id,
      chatId: chat.id,
      mainCurrency: linked.main_currency,
      text: `${captionPart}[photo_path: ${photoPath}]`,
      image: { data: bytes, mimeType: "image/jpeg" },
    });
    await ctx.reply(out.text);
  } catch (err) {
    if (err instanceof AgentQuotaError) {
      await ctx.reply(QUOTA_ERROR);
      return;
    }
    console.error("[telegram/photo] agent error", err);
    await ctx.reply(GENERIC_ERROR);
  }
}
