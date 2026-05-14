// Inline-keyboard callback handler for the AI confirmation flow.
//
// Callback data scheme (always `<prefix>:<uuid>`):
//   - `confirm:<id>`   write the suggested transaction, delete pending,
//                      edit the message to "Guardado".
//   - `edit:<id>`      see "Wave 4C simplification" below.
//   - `cancel:<id>`    delete pending, edit message to "Cancelado".
//
// We always call `ctx.answerCallbackQuery()` so Telegram clears the
// loading spinner on the user's button — failing to do so makes the
// button feel broken.
//
// =============================================================================
// Wave 4C simplification — the edit flow
// =============================================================================
// A full edit UX would need either grammY conversations or a multi-message
// state machine (track which field is being edited, listen for the next
// free-text reply, validate it, patch the pending row, re-show preview).
// That's a sizable chunk of code and tests for a personal-scale bot, so
// Wave 4C ships a placeholder: tapping "Editar" tells the user to confirm
// now and tweak in the web app via /transactions. The keyboard is
// re-presented so they can immediately confirm or cancel without scrolling
// back. The richer flow is a Wave 5 polish item.
// =============================================================================

import type { Bot, Context } from "grammy";

import type { ExpenseExtraction } from "@/lib/ai/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, TxType } from "@/lib/supabase/database.types";

import { buildConfirmKeyboard } from "./text";

const SAVED_TEXT = "✅ Guardado";
const CANCELLED_TEXT = "❌ Cancelado";
const NOT_FOUND_TEXT = "La acción ya no está disponible";
const ERROR_TEXT = "Algo falló";
const EDIT_HINT_TEXT =
  "Por ahora editá en la app desde /transactions después de confirmar. Confirmá o cancelá ahora.";

const CALLBACK_RE = /^(confirm|edit|cancel):([0-9a-f-]{36})$/i;

// Local untyped reference to `telegram_pending`. The shared admin client
// is typed against `database.types.ts` which doesn't yet include this
// table (that file is owned by another track). We cast once at the call
// site to keep the rest of the module clean.
type AnySupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          maybeSingle: () => Promise<{ data: PendingRow | null; error: unknown }>;
        };
      };
    };
    delete: () => {
      eq: (col: string, val: unknown) => Promise<{ error: unknown }>;
    };
  };
};

export function registerConfirmHandler(bot: Bot): void {
  bot.on("callback_query:data", handleCallback);
}

async function handleCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const chat = ctx.chat;
  if (!data || !chat) return;

  const match = CALLBACK_RE.exec(data);
  if (!match) {
    // Unknown prefix. Clear the spinner so the UI doesn't appear stuck.
    await ctx.answerCallbackQuery();
    return;
  }

  const action = match[1].toLowerCase() as "confirm" | "edit" | "cancel";
  const pendingId = match[2];

  // Pre-provisioning safety: silently no-op if Supabase isn't configured.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }

  if (action === "edit") {
    // See "Wave 4C simplification" header — we just re-offer the keyboard.
    await ctx.answerCallbackQuery();
    await ctx.reply(EDIT_HINT_TEXT, {
      reply_markup: buildConfirmKeyboard(pendingId),
    });
    return;
  }

  // Load the pending row scoped by chat id so a guessed UUID can't be
  // confirmed by a different user.
  const { data: pending, error: pendingError } = await loadPending(
    supabase as unknown as AnySupabase,
    pendingId,
    chat.id,
  );

  if (pendingError) {
    console.error("[telegram/confirm] load pending failed", pendingError);
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  if (!pending) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    await safeEditMessageText(ctx, NOT_FOUND_TEXT);
    return;
  }

  if (action === "cancel") {
    await deletePending(supabase as unknown as AnySupabase, pending.id);
    await ctx.answerCallbackQuery({ text: "Cancelado" });
    await safeEditMessageText(ctx, CANCELLED_TEXT);
    return;
  }

  // action === "confirm"
  const ok = await createTransactionFromPending(supabase, pending);
  if (!ok) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }

  // Delete the pending row. Failure isn't fatal — `expires_at` provides
  // an eventual cleanup, and we'd rather show "Guardado" than retry.
  await deletePending(supabase as unknown as AnySupabase, pending.id);

  await ctx.answerCallbackQuery({ text: "Guardado" });
  await safeEditMessageText(ctx, SAVED_TEXT);
}

// ----- helpers --------------------------------------------------------------

interface PendingRow {
  id: string;
  user_id: string;
  telegram_chat_id: number;
  extraction: ExpenseExtraction;
  photo_path: string | null;
  suggested_wallet_id: string | null;
  suggested_category_id: string | null;
  source: Database["public"]["Enums"]["tx_source"];
}

/**
 * Load a pending row scoped by both id AND telegram_chat_id. The chat
 * scope prevents cross-user replay if a button is forwarded.
 */
async function loadPending(
  supabase: AnySupabase,
  id: string,
  chatId: number,
): Promise<{ data: PendingRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("telegram_pending")
    .select(
      "id, user_id, telegram_chat_id, extraction, photo_path, suggested_wallet_id, suggested_category_id, source",
    )
    .eq("id", id)
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  return { data, error };
}

async function deletePending(supabase: AnySupabase, id: string): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[telegram/confirm] delete pending failed", error);
  }
}

/**
 * Persist the AI suggestion as a real `transactions` row. We don't go
 * through `actions/transactions.ts:createTransaction` because that server
 * action expects a Supabase session — the webhook has none. Instead we
 * write via the admin client, manually scoped by the `user_id` stored on
 * the pending row (which was derived from `getLinkedUser` when the
 * preview was generated, so it's trustworthy).
 */
async function createTransactionFromPending(
  supabase: ReturnType<typeof createAdminClient>,
  pending: PendingRow,
): Promise<boolean> {
  const ex = pending.extraction;

  // Defensive: the handlers upstream filter `unknown` already.
  if (ex.type !== "expense" && ex.type !== "income") {
    console.error(
      "[telegram/confirm] refusing to insert non-tx extraction",
      ex.type,
    );
    return false;
  }

  if (!pending.suggested_wallet_id) {
    console.error("[telegram/confirm] pending missing wallet");
    return false;
  }
  if (!ex.amount || ex.amount <= 0) {
    console.error("[telegram/confirm] pending missing/invalid amount");
    return false;
  }

  // Currency from the wallet — never trust the model. We re-fetch instead
  // of trusting the preview snapshot because the wallet may have changed
  // between preview and confirm.
  const { data: wallet, error: walletErr } = await supabase
    .from("wallets")
    .select("id, user_id, currency, archived")
    .eq("id", pending.suggested_wallet_id)
    .eq("user_id", pending.user_id)
    .maybeSingle();
  if (walletErr || !wallet || wallet.archived) {
    console.error(
      "[telegram/confirm] wallet invalid at confirm time",
      walletErr,
    );
    return false;
  }

  let categoryId: string | null = null;
  if (pending.suggested_category_id) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id, type")
      .eq("id", pending.suggested_category_id)
      .eq("user_id", pending.user_id)
      .maybeSingle();
    if (cat && cat.type === (ex.type as TxType)) {
      categoryId = cat.id;
    }
  }

  const occurred = ex.occurred_at ? new Date(ex.occurred_at) : new Date();

  const { error: insertError } = await supabase.from("transactions").insert({
    user_id: pending.user_id,
    wallet_id: wallet.id,
    category_id: categoryId,
    type: ex.type,
    amount: ex.amount,
    currency: wallet.currency,
    occurred_at: occurred.toISOString(),
    description: ex.description ?? null,
    payee: ex.payee ?? null,
    photo_path: pending.photo_path,
    source: pending.source,
    source_metadata: { ai: ex },
  });
  if (insertError) {
    console.error("[telegram/confirm] transaction insert failed", insertError);
    return false;
  }
  return true;
}

/**
 * Best-effort edit of the message that carried the inline keyboard. We
 * swallow errors because the message may have been deleted or its content
 * may no longer be editable (48-hour limit) — neither is a real failure.
 */
async function safeEditMessageText(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.editMessageText(text);
  } catch (err) {
    console.error("[telegram/confirm] edit message failed", err);
  }
}
