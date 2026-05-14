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
import { setAwaitingMode } from "@/lib/telegram/chat-state";
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
  await deleteBatch(supabase, batchId);
  await ctx.answerCallbackQuery({ text: "Cancelado" });
  try {
    await ctx.editMessageText(CANCELLED_TEXT);
  } catch (err) {
    console.error("[telegram/batch] edit failed", err);
  }
}

// =============================================================================
// Stubs — se implementan en Tasks J2/J3/K1 para que el typecheck pase ya.
// =============================================================================
async function handleConfirm(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
  includeDuplicates: boolean,
): Promise<void> {
  void supabase;
  void data;
  void includeDuplicates;
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleEnterExclude(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  void supabase;
  void data;
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleEnterTransfer(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  void supabase;
  void data;
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleSetCounterpart(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  void supabase;
  void data;
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleTransferDone(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  void supabase;
  void data;
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
