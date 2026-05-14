// Helper para operaciones de batch sobre telegram_pending. Encapsula los
// CAST necesarios mientras `database.types.ts` no incluye las columnas
// nuevas en su totalidad (las agregamos en Task A2 pero algunos métodos
// agregados requieren cast por las foreign keys).

import { randomUUID } from "node:crypto";

import type { ExpenseItem } from "@/lib/ai/schemas";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BatchInsertInput {
  userId: string;
  telegramChatId: number;
  telegramMessageId?: number | null;
  source: Database["public"]["Enums"]["tx_source"];
  walletId: string | null;
  items: Array<{
    item: ExpenseItem;
    categoryId: string | null;
    photoPath: string | null;
  }>;
}

export interface BatchPendingRow {
  id: string;
  batch_index: number;
  extraction: ExpenseItem;
  is_duplicate: boolean;
  transfer_hint: boolean;
  excluded: boolean;
  counterpart_wallet_id: string | null;
  duplicate_of_tx_id: string | null;
  suggested_wallet_id: string | null;
  suggested_category_id: string | null;
  photo_path: string | null;
  source: Database["public"]["Enums"]["tx_source"];
  user_id: string;
  telegram_chat_id: number;
  telegram_message_id: number | null;
}

export async function insertPendingBatch(
  supabase: AdminClient,
  input: BatchInsertInput,
): Promise<{ batchId: string; rowIds: string[] } | null> {
  const batchId = randomUUID();
  const rows = input.items.map((entry, index) => ({
    user_id: input.userId,
    telegram_chat_id: input.telegramChatId,
    telegram_message_id: input.telegramMessageId ?? null,
    extraction: entry.item as unknown as Database["public"]["Tables"]["telegram_pending"]["Insert"]["extraction"],
    photo_path: entry.photoPath,
    suggested_wallet_id: input.walletId,
    suggested_category_id: entry.categoryId,
    source: input.source,
    batch_id: batchId,
    batch_index: index,
    transfer_hint: entry.item.transfer_hint,
  }));

  const { data, error } = await supabase
    .from("telegram_pending")
    .insert(rows)
    .select("id");

  if (error || !data) {
    console.error("[telegram/pending-batch] insert failed", error);
    return null;
  }

  return { batchId, rowIds: data.map((r) => r.id) };
}

export async function attachMessageIdToBatch(
  supabase: AdminClient,
  batchId: string,
  telegramMessageId: number,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .update({ telegram_message_id: telegramMessageId })
    .eq("batch_id", batchId);
  if (error) {
    console.error("[telegram/pending-batch] attach message_id failed", error);
  }
}

export async function setWalletForBatch(
  supabase: AdminClient,
  batchId: string,
  walletId: string,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .update({ suggested_wallet_id: walletId })
    .eq("batch_id", batchId);
  if (error) {
    console.error("[telegram/pending-batch] set wallet failed", error);
  }
}

export async function applyDedupFlags(
  supabase: AdminClient,
  batchId: string,
  flags: Array<{ batch_index: number; is_duplicate: boolean; duplicate_of_tx_id: string | null }>,
): Promise<void> {
  for (const f of flags) {
    if (!f.is_duplicate) continue;
    const { error } = await supabase
      .from("telegram_pending")
      .update({
        is_duplicate: true,
        duplicate_of_tx_id: f.duplicate_of_tx_id,
      })
      .eq("batch_id", batchId)
      .eq("batch_index", f.batch_index);
    if (error) {
      console.error("[telegram/pending-batch] dedup flag failed", error);
    }
  }
}

export async function loadBatch(
  supabase: AdminClient,
  batchId: string,
  telegramChatId: number,
): Promise<BatchPendingRow[]> {
  const { data, error } = await supabase
    .from("telegram_pending")
    .select(
      "id, batch_index, extraction, is_duplicate, transfer_hint, excluded, counterpart_wallet_id, duplicate_of_tx_id, suggested_wallet_id, suggested_category_id, photo_path, source, user_id, telegram_chat_id, telegram_message_id",
    )
    .eq("batch_id", batchId)
    .eq("telegram_chat_id", telegramChatId)
    .order("batch_index", { ascending: true });

  if (error || !data) {
    console.error("[telegram/pending-batch] load failed", error);
    return [];
  }
  return data as unknown as BatchPendingRow[];
}

export async function excludeIndices(
  supabase: AdminClient,
  batchId: string,
  indices: number[],
): Promise<{ excluded: number[]; notFound: number[] }> {
  if (indices.length === 0) return { excluded: [], notFound: [] };

  const { data: rows, error: fetchError } = await supabase
    .from("telegram_pending")
    .select("batch_index")
    .eq("batch_id", batchId);
  if (fetchError) {
    console.error("[telegram/pending-batch] exclude fetch failed", fetchError);
    return { excluded: [], notFound: indices };
  }
  const existing = new Set((rows ?? []).map((r) => r.batch_index as number));
  const valid = indices.filter((i) => existing.has(i));
  const notFound = indices.filter((i) => !existing.has(i));

  if (valid.length > 0) {
    const { error } = await supabase
      .from("telegram_pending")
      .update({ excluded: true })
      .eq("batch_id", batchId)
      .in("batch_index", valid);
    if (error) {
      console.error("[telegram/pending-batch] exclude failed", error);
    }
  }

  return { excluded: valid, notFound };
}

export async function setCounterpart(
  supabase: AdminClient,
  pendingId: string,
  counterpartWalletId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .update({ counterpart_wallet_id: counterpartWalletId })
    .eq("id", pendingId);
  if (error) {
    console.error("[telegram/pending-batch] set counterpart failed", error);
  }
}

export async function deleteBatch(
  supabase: AdminClient,
  batchId: string,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .delete()
    .eq("batch_id", batchId);
  if (error) {
    console.error("[telegram/pending-batch] delete failed", error);
  }
}
