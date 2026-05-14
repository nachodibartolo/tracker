// Free-text expense handler.
//
// Flow for an already-linked user:
//   1. Read `ctx.message.text` (skipping commands so /start, /saldo, etc.
//      can match their own handlers earlier in the chain).
//   2. Run the AI extractor (Wave 2D). Bail with a helpful hint when the
//      model returns `type='unknown'` or low confidence.
//   3. Resolve the user's wallet (default → first non-archived).
//   4. Resolve the AI's `category_hint` into one of the user's categories.
//   5. Persist a `telegram_pending` row capturing the suggestion.
//   6. Reply with the preview + a 3-button inline keyboard whose callback
//      data carries the pending id. The actual write to `transactions`
//      happens in `confirm.ts` when the user taps "Confirmar".

import { type Bot, type Context, InlineKeyboard, type NextFunction } from "grammy";

import { AiExtractionError, extractFromText } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import { buildPreview } from "@/lib/telegram/preview";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No entendí. Probá: 'gasté 200 en almuerzo'";
const GENERIC_ERROR = "Algo falló procesando tu mensaje. Probá de nuevo.";

const MIN_CONFIDENCE = 0.4;

export function registerTextHandler(bot: Bot): void {
  // We deliberately use `bot.on("message:text", ...)` and short-circuit on
  // command messages so command-specific handlers (registered earlier) still
  // match. grammY runs middleware top-to-bottom, but `bot.command(...)` and
  // `bot.on("message:text")` are independent matchers — both fire for a
  // command message. Skipping here lets us treat /start, /saldo, etc. as
  // "not free-text".
  bot.on("message:text", handleText);
}

async function handleText(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (!from || !chat || !message || !message.text) {
    return next();
  }

  // Let commands fall through to other handlers (the catch-all, in
  // particular, replies with the help text for unknown commands).
  const commandEntities = ctx.entities("bot_command");
  if (commandEntities.length > 0) {
    return next();
  }

  // Pre-provisioning safety: if Supabase env is missing, getLinkedUser
  // returns null, so we can't distinguish "unlinked" from "not configured".
  // Treat the missing-env case as a maintenance state and stay silent on
  // the link copy.
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured) {
    await ctx.reply(MAINTENANCE_TEXT);
    return;
  }

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }

  // AI env may be missing in pre-provisioning. Catch + degrade quietly.
  let extraction;
  try {
    extraction = await extractFromText(message.text, linked.main_currency);
  } catch (err) {
    if (err instanceof AiExtractionError) {
      console.error("[telegram/text] AI extraction failed", err);
    } else {
      console.error("[telegram/text] unexpected extractor error", err);
    }
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  if (extraction.type === "unknown" || extraction.confidence < MIN_CONFIDENCE) {
    await ctx.reply(NO_UNDERSTAND_TEXT);
    return;
  }

  const supabase = createAdminClient();

  // Wallet resolution: prefer the user's explicit default, else first
  // non-archived wallet ordered by `position`. Currency is derived from the
  // wallet (or AI's stated currency, falling back to wallet's) so we never
  // store a tx in a currency the wallet doesn't transact in.
  const wallet = await loadWallet(supabase, linked.user_id, linked.default_wallet_id);
  if (!wallet) {
    await ctx.reply(NO_WALLET_TEXT);
    return;
  }

  // Category — for income/expense the resolver matches against the user's
  // categories filtered by `type`. `extraction.type` is guaranteed to be
  // 'expense' | 'income' here (we filtered 'unknown' above).
  const txType = extraction.type as "expense" | "income";
  const category = await resolveCategory(
    supabase,
    linked.user_id,
    txType,
    extraction.category_hint,
  );

  // Insert the pending row. `extraction` is stored as-is so the confirm
  // handler has the full payload (and we can audit AI behaviour later).
  const { data: pending, error: pendingError } = await insertPending(
    supabase,
    linked.user_id,
    chat.id,
    extraction,
    wallet.id,
    category.id,
    "telegram_text",
    null,
  );

  if (pendingError || !pending) {
    console.error("[telegram/text] pending insert failed", pendingError);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  const preview = buildPreview(
    extraction,
    wallet.name,
    wallet.currency,
    category.label,
    false,
    "telegram_text",
  );

  const keyboard = buildConfirmKeyboard(pending.id);
  await ctx.reply(preview.text, {
    parse_mode: preview.markdown,
    reply_markup: keyboard,
  });
}

// ----- shared helpers (also used by photo / voice) --------------------------

/**
 * Resolve a usable wallet for the given user. Prefers the configured
 * default; falls back to the first non-archived wallet ordered by
 * `position`. Returns `null` if the user has no wallets at all.
 */
export async function loadWallet(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  defaultWalletId: string | null,
): Promise<{
  id: string;
  name: string;
  currency: string;
} | null> {
  if (defaultWalletId) {
    const { data, error } = await supabase
      .from("wallets")
      .select("id, name, currency, archived")
      .eq("id", defaultWalletId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data && !data.archived) {
      return { id: data.id, name: data.name, currency: data.currency };
    }
  }

  const { data, error } = await supabase
    .from("wallets")
    .select("id, name, currency")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id, name: data.name, currency: data.currency };
}

/**
 * Insert a `telegram_pending` row and return the new id. The admin
 * client's typed schema doesn't include `telegram_pending` yet
 * (`database.types.ts` is owned by another track and was hand-written
 * before this migration); we cast the table name to keep the call typed
 * without modifying that file. The runtime contract matches
 * `supabase/migrations/0008_telegram_pending.sql`.
 */
export async function insertPending(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  telegramChatId: number,
  extraction: unknown,
  suggestedWalletId: string | null,
  suggestedCategoryId: string | null,
  source: Database["public"]["Enums"]["tx_source"],
  photoPath: string | null,
): Promise<{ data: { id: string } | null; error: unknown }> {
  const row = {
    user_id: userId,
    telegram_chat_id: telegramChatId,
    extraction,
    photo_path: photoPath,
    suggested_wallet_id: suggestedWalletId,
    suggested_category_id: suggestedCategoryId,
    source,
  };
  // Cast to a permissive supabase reference so the unlisted table compiles.
  // See note above the function signature.
  const { data, error } = await (
    supabase as unknown as {
      from: (t: string) => {
        insert: (r: unknown) => {
          select: (cols: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: unknown;
            }>;
          };
        };
      };
    }
  )
    .from("telegram_pending")
    .insert(row)
    .select("id")
    .single();
  return { data, error };
}

/** Build the standard 3-button confirm/edit/cancel keyboard. */
export function buildConfirmKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirmar", `confirm:${pendingId}`)
    .text("✏️ Editar", `edit:${pendingId}`)
    .text("❌ Cancelar", `cancel:${pendingId}`);
}

