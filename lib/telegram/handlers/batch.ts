// Callback handler para los prefijos `b*` (batch). Coexiste con el handler
// legacy (`confirm:`, `edit:`, `cancel:`) en `confirm.ts`.
//
// Prefijos:
//   bwallet:<batch_id>:<wallet_id>  → set wallet del batch + corre dedup + muestra preview
//   bconf:<batch_id>                → confirma items no excluidos y no dup
//   bconfall:<batch_id>             → confirma items no excluidos (incluye dups)
//   bexcl:<batch_id>                → entra a modo exclusión
//   bcanc:<batch_id>                → cancela batch entero
//   btrans:<batch_id>               → entra a modo marcado de transfers
//   btrset:<pending_id>:<wallet_id> → set counterpart para un item específico
//   btrdone:<batch_id>              → vuelve al preview principal

import type { Bot, Context } from "grammy";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { clearAwaiting, setAwaitingMode } from "@/lib/telegram/chat-state";
import { deduplicateBatch } from "@/lib/telegram/dedup";
import {
  applyDedupFlags,
  deleteBatch,
  loadBatch,
  setCounterpart,
  setWalletForBatch,
} from "@/lib/telegram/pending-batch";
import { buildBatchPreview, paginatePreview, type BatchPreviewItemInput } from "@/lib/telegram/preview-batch";

const ERROR_TEXT = "Algo falló";
const NOT_FOUND_TEXT = "El batch ya no está disponible";
const CANCELLED_TEXT = "❌ Batch cancelado";

const BATCH_CALLBACK_RE = /^(bwallet|bconf|bconfall|bexcl|bcanc|btrans|btrset|btrdone):/;

export function registerBatchHandler(bot: Bot): void {
  bot.on("callback_query:data", handleBatchCallback);
}

async function handleBatchCallback(ctx: Context, next: () => Promise<void>): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !BATCH_CALLBACK_RE.test(data)) {
    return next();
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }

  const supabase = createAdminClient();
  const chat = ctx.chat;
  if (!chat) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith("bwallet:")) {
    await handleWalletPick(ctx, supabase, data);
  } else if (data.startsWith("bcanc:")) {
    await handleCancel(ctx, supabase, data);
  } else if (data.startsWith("bconfall:")) {
    await handleConfirm(ctx, supabase, data, true);
  } else if (data.startsWith("bconf:")) {
    await handleConfirm(ctx, supabase, data, false);
  } else if (data.startsWith("bexcl:")) {
    await handleEnterExclude(ctx, supabase, data);
  } else if (data.startsWith("btrans:")) {
    await handleEnterTransfer(ctx, supabase, data);
  } else if (data.startsWith("btrset:")) {
    await handleSetCounterpart(ctx, supabase, data);
  } else if (data.startsWith("btrdone:")) {
    await handleTransferDone(ctx, supabase, data);
  } else {
    await ctx.answerCallbackQuery();
  }
}

// =============================================================================
// bwallet — usuario eligió wallet en el selector
// =============================================================================
async function handleWalletPick(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length !== 3) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const [, batchId, walletId] = parts;
  if (!batchId || !walletId) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const chatId = ctx.chat!.id;

  const rows = await loadBatch(supabase, batchId, chatId);
  if (rows.length === 0) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }

  await setWalletForBatch(supabase, batchId, walletId);

  const items = rows.map((r) => r.extraction);
  const dedup = await deduplicateBatch(supabase, rows[0].user_id, walletId, items, batchId);
  await applyDedupFlags(supabase, batchId, dedup);

  await renderBatchPreview(ctx, supabase, batchId, chatId);
  await ctx.answerCallbackQuery();
}

// =============================================================================
// bcanc — cancelar todo el batch
// =============================================================================
async function handleCancel(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  if (!batchId) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const chatId = ctx.chat!.id;
  // Ownership check — loadBatch filters by telegram_chat_id, so an
  // empty result means this chat doesn't own this batch (or it's gone).
  const rows = await loadBatch(supabase, batchId, chatId);
  if (rows.length === 0) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }
  await deleteBatch(supabase, batchId);
  await ctx.answerCallbackQuery({ text: "Cancelado" });
  try {
    await ctx.editMessageText(CANCELLED_TEXT);
  } catch (err) {
    console.error("[telegram/batch] edit failed", err);
  }
}

async function handleConfirm(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
  includeDuplicates: boolean,
): Promise<void> {
  const batchId = data.split(":")[1];
  const chatId = ctx.chat!.id;
  const rows = await loadBatch(supabase, batchId, chatId);
  if (rows.length === 0) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }

  const toPersist = rows.filter(
    (r) => !r.excluded && (includeDuplicates || !r.is_duplicate),
  );

  // Delete BEFORE persisting to make the operation idempotent under
  // double-taps. A second concurrent tap will see loadBatch=[] and exit.
  // The downside (partial persist losing the unwritten pending rows on
  // failure) is acceptable for personal-scale; duplicate writes are worse.
  await deleteBatch(supabase, batchId);

  let persisted = 0;
  let failed = 0;

  for (const row of toPersist) {
    if (row.counterpart_wallet_id && row.suggested_wallet_id) {
      const ok = await persistTransfer(supabase, row);
      if (ok) persisted++;
      else failed++;
    } else {
      const ok = await persistExpenseIncome(supabase, row);
      if (ok) persisted++;
      else failed++;
    }
  }

  const excludedCount = rows.filter((r) => r.excluded).length;
  const skippedDupCount = !includeDuplicates ? rows.filter((r) => r.is_duplicate && !r.excluded).length : 0;
  const failureNote = failed > 0 ? `\n   ⚠️ ${failed} fallaron` : "";

  try {
    await ctx.editMessageText(
      `✅ ${persisted} movimientos guardados\n   ❌ ${skippedDupCount} duplicados omitidos\n   ↩️ ${excludedCount} excluidos por vos${failureNote}`,
    );
  } catch (err) {
    console.error("[telegram/batch] edit after confirm failed", err);
  }
  await ctx.answerCallbackQuery({ text: "Listo" });
}

async function persistExpenseIncome(
  supabase: ReturnType<typeof createAdminClient>,
  row: import("@/lib/telegram/pending-batch").BatchPendingRow,
): Promise<boolean> {
  const ex = row.extraction;
  if (ex.type !== "expense" && ex.type !== "income") return false;
  if (!ex.amount || ex.amount <= 0) return false;
  if (!row.suggested_wallet_id) return false;

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, currency, archived")
    .eq("id", row.suggested_wallet_id)
    .maybeSingle();
  if (!wallet || wallet.archived) return false;

  const occurred = ex.occurred_at ? new Date(ex.occurred_at) : new Date();

  const { error } = await supabase.from("transactions").insert({
    user_id: row.user_id,
    wallet_id: wallet.id,
    category_id: row.suggested_category_id,
    type: ex.type,
    amount: ex.amount,
    currency: wallet.currency,
    occurred_at: occurred.toISOString(),
    description: ex.description ?? null,
    payee: ex.payee ?? null,
    photo_path: row.photo_path,
    source: row.source,
    source_metadata: { ai: ex, batch_id: row.id },
  });
  if (error) {
    console.error("[telegram/batch] tx insert failed", error);
    return false;
  }
  return true;
}

async function persistTransfer(
  supabase: ReturnType<typeof createAdminClient>,
  row: import("@/lib/telegram/pending-batch").BatchPendingRow,
): Promise<boolean> {
  const ex = row.extraction;
  if (!ex.amount || ex.amount <= 0) return false;
  if (!row.suggested_wallet_id || !row.counterpart_wallet_id) return false;

  // Direction: expense → out of suggested wallet, into counterpart.
  //             income  → into suggested wallet, out of counterpart.
  const fromId = ex.type === "expense" ? row.suggested_wallet_id : row.counterpart_wallet_id;
  const toId = ex.type === "expense" ? row.counterpart_wallet_id : row.suggested_wallet_id;

  // Re-validate both wallets at confirm time. The counterpart FK is
  // ON DELETE SET NULL, but pending rows may also reference wallets that
  // got archived between marking and confirm. Either case → fall back to
  // expense/income persistence.
  const { data: wallets } = await supabase
    .from("wallets")
    .select("id, currency, archived")
    .in("id", [fromId, toId]);
  const fromW = wallets?.find((w) => w.id === fromId);
  const toW = wallets?.find((w) => w.id === toId);
  if (!fromW || !toW || fromW.archived || toW.archived) {
    return persistExpenseIncome(supabase, row);
  }

  const sameCurrency = fromW.currency.toUpperCase() === toW.currency.toUpperCase();
  if (!sameCurrency) {
    // Different currencies require an FX rate we don't have at this layer.
    // Fall back to plain expense/income persistence so wallets stay in sync.
    return persistExpenseIncome(supabase, row);
  }

  const occurred = ex.occurred_at ? new Date(ex.occurred_at) : new Date();

  const { error } = await (
    supabase.rpc as unknown as (
      fn: "create_transfer",
      args: {
        p_user_id: string;
        p_from_wallet: string;
        p_to_wallet: string;
        p_amount_from: number;
        p_amount_to: number;
        p_currency_from: string;
        p_currency_to: string;
        p_fx_rate: number;
        p_occurred_at: string;
        p_note: string | null;
      },
    ) => Promise<{ data: string | null; error: { message?: string } | null }>
  )("create_transfer", {
    p_user_id: row.user_id,
    p_from_wallet: fromId,
    p_to_wallet: toId,
    p_amount_from: ex.amount,
    p_amount_to: ex.amount,
    p_currency_from: fromW.currency.toUpperCase(),
    p_currency_to: toW.currency.toUpperCase(),
    p_fx_rate: 1,
    p_occurred_at: occurred.toISOString(),
    p_note: ex.description ?? null,
  });

  if (error) {
    console.error("[telegram/batch] create_transfer RPC failed", error);
    return false;
  }
  return true;
}

async function handleEnterExclude(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  const chatId = ctx.chat!.id;
  const ok = await setAwaitingMode(supabase, chatId, "exclude", batchId);
  if (!ok) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  await ctx.reply(
    "Mandá los números a excluir separados por coma (ej: 3,7,12) o /cancel para volver. Tenés 2 minutos.",
  );
  await ctx.answerCallbackQuery();
}

async function handleEnterTransfer(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  if (!batchId) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const chatId = ctx.chat!.id;
  const rows = await loadBatch(supabase, batchId, chatId);
  if (rows.length === 0) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }

  const targets = rows.filter((r) => r.transfer_hint && !r.excluded);
  if (targets.length === 0) {
    await ctx.answerCallbackQuery({ text: "No hay transfers para marcar" });
    return;
  }

  const userId = rows[0].user_id;
  const targetWalletId = rows[0].suggested_wallet_id;
  if (!targetWalletId) {
    await ctx.answerCallbackQuery({ text: "Elegí una wallet primero" });
    return;
  }

  const { data: wallets } = await supabase
    .from("wallets")
    .select("id, name")
    .eq("user_id", userId)
    .eq("archived", false)
    .neq("id", targetWalletId)
    .order("position", { ascending: true });

  if (!wallets || wallets.length === 0) {
    await ctx.answerCallbackQuery({ text: "No tenés otra wallet" });
    return;
  }

  const ok = await setAwaitingMode(supabase, chatId, "transfer", batchId);
  if (!ok) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  await ctx.answerCallbackQuery();

  for (const row of targets) {
    const ex = row.extraction;
    const dateStr = ex.occurred_at ? new Date(ex.occurred_at).toLocaleDateString("es-AR") : "?";
    const summary = `${dateStr} · ${ex.amount ?? "?"} · ${ex.payee ?? ex.description ?? "—"}`;
    const buttons = wallets.map((w) => ({
      text: w.name,
      callback_data: `btrset:${row.id}:${w.id}`,
    }));
    const inline: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inline.push(buttons.slice(i, i + 2));
    }
    await ctx.reply(`🔄 ${summary} → ¿a qué wallet?`, {
      reply_markup: { inline_keyboard: inline },
    });
  }

  await ctx.reply("Cuando termines, tapeá el botón.", {
    reply_markup: {
      inline_keyboard: [[{ text: "← Volver al preview", callback_data: `btrdone:${batchId}` }]],
    },
  });
}

async function handleSetCounterpart(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length !== 3) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const [, pendingId, walletId] = parts;
  if (!pendingId || !walletId) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const chatId = ctx.chat!.id;

  // Ownership check — confirm this chat owns the pending row before mutating.
  const { data: pending } = await supabase
    .from("telegram_pending")
    .select("telegram_chat_id")
    .eq("id", pendingId)
    .maybeSingle();
  if (!pending || pending.telegram_chat_id !== chatId) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }

  await setCounterpart(supabase, pendingId, walletId);
  await ctx.answerCallbackQuery({ text: "🔁 marcado" });
  try {
    await ctx.editMessageText("🔁 transfer asignado a wallet");
  } catch (err) {
    console.error("[telegram/batch] edit transfer-set failed", err);
  }
}

async function handleTransferDone(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  if (!batchId) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const chatId = ctx.chat!.id;
  await clearAwaiting(supabase, chatId);
  await renderBatchPreview(ctx, supabase, batchId, chatId);
  await ctx.answerCallbackQuery();
}

// =============================================================================
// Render del preview principal — se usa después de wallet pick, exclude, transfer
// =============================================================================
export async function renderBatchPreview(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  batchId: string,
  telegramChatId: number,
): Promise<number | null> {
  const rows = await loadBatch(supabase, batchId, telegramChatId);
  if (rows.length === 0) return null;

  const walletId = rows[0].suggested_wallet_id;
  if (!walletId) return null;

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, name, currency")
    .eq("id", walletId)
    .maybeSingle();
  if (!wallet) return null;

  const userId = rows[0].user_id;

  const counterpartIds = rows
    .map((r) => r.counterpart_wallet_id)
    .filter((id): id is string => typeof id === "string");
  const counterpartNames = new Map<string, string>();
  if (counterpartIds.length > 0) {
    const { data: cw } = await supabase
      .from("wallets")
      .select("id, name")
      .in("id", counterpartIds);
    for (const w of cw ?? []) counterpartNames.set(w.id, w.name);
  }

  const previewItems: BatchPreviewItemInput[] = [];
  for (const row of rows) {
    const cat = await resolveCategory(
      supabase,
      userId,
      row.extraction.type === "income" ? "income" : "expense",
      row.extraction.category_hint,
      row.extraction.subcategory_hint,
    );
    previewItems.push({
      batch_index: row.batch_index,
      item: row.extraction,
      category_label: cat.label,
      is_duplicate: row.is_duplicate,
      duplicate_label: row.duplicate_of_tx_id ? "tx existente" : row.is_duplicate ? "pending" : null,
      transfer_hint: row.transfer_hint,
      counterpart_wallet_name: row.counterpart_wallet_id
        ? counterpartNames.get(row.counterpart_wallet_id) ?? null
        : null,
      excluded: row.excluded,
    });
  }

  const preview = buildBatchPreview({
    walletName: wallet.name,
    walletCurrency: wallet.currency,
    items: previewItems,
  });

  const pages = paginatePreview(preview.text);
  const keyboard = buildBatchKeyboard(batchId, rows.some((r) => r.transfer_hint && !r.counterpart_wallet_id));

  let lastMessageId: number | null = null;
  for (let i = 0; i < pages.length; i++) {
    const isLast = i === pages.length - 1;
    const msg = await ctx.reply(pages[i], {
      parse_mode: preview.markdown,
      reply_markup: isLast ? keyboard : undefined,
    });
    lastMessageId = msg.message_id;
  }

  return lastMessageId;
}

function buildBatchKeyboard(batchId: string, showTransferButton: boolean): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  rows.push([{ text: "✅ Confirmar (excl dups)", callback_data: `bconf:${batchId}` }]);
  rows.push([{ text: "✅ Confirmar TODO", callback_data: `bconfall:${batchId}` }]);
  const actionsRow: Array<{ text: string; callback_data: string }> = [
    { text: "✏️ Excluir items", callback_data: `bexcl:${batchId}` },
  ];
  if (showTransferButton) {
    actionsRow.push({ text: "🔄 Marcar transfers", callback_data: `btrans:${batchId}` });
  }
  rows.push(actionsRow);
  rows.push([{ text: "❌ Cancelar", callback_data: `bcanc:${batchId}` }]);
  return { inline_keyboard: rows };
}
