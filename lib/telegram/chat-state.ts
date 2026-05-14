// Mini key-value table for "modo exclusión" and "modo transfer". One row per
// Telegram chat. Expires in 2 minutes by default.
//
// Trust assumption: this table is service-role only and does NOT include a
// user_id column. We rely on the chat-id-to-user mapping that lives in
// `telegram_users` (validated by the handler upstream via getLinkedUser).
// In a multi-user-per-chat setup this would need a (chat_id, user_id)
// composite key.

import type { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

const TTL_MINUTES = 2;

export type ChatStateMode = "exclude" | "transfer";

export async function setAwaitingMode(
  supabase: AdminClient,
  chatId: number,
  mode: ChatStateMode,
  batchId: string,
): Promise<void> {
  const expires = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();
  const payload: TablesInsert<"telegram_chat_state"> =
    mode === "exclude"
      ? {
          telegram_chat_id: chatId,
          awaiting_exclude_batch_id: batchId,
          awaiting_transfer_batch_id: null,
          set_at: new Date().toISOString(),
          expires_at: expires,
        }
      : {
          telegram_chat_id: chatId,
          awaiting_exclude_batch_id: null,
          awaiting_transfer_batch_id: batchId,
          set_at: new Date().toISOString(),
          expires_at: expires,
        };

  const { error } = await supabase
    .from("telegram_chat_state")
    .upsert(payload, { onConflict: "telegram_chat_id" });
  if (error) {
    console.error("[telegram/chat-state] upsert failed", error);
  }
}

export async function getActiveAwaiting(
  supabase: AdminClient,
  chatId: number,
): Promise<{ mode: ChatStateMode; batchId: string } | null> {
  const { data, error } = await supabase
    .from("telegram_chat_state")
    .select("awaiting_exclude_batch_id, awaiting_transfer_batch_id, expires_at")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (error || !data) return null;

  if (new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }
  if (data.awaiting_exclude_batch_id) {
    return { mode: "exclude", batchId: data.awaiting_exclude_batch_id };
  }
  if (data.awaiting_transfer_batch_id) {
    return { mode: "transfer", batchId: data.awaiting_transfer_batch_id };
  }
  return null;
}

export async function clearAwaiting(
  supabase: AdminClient,
  chatId: number,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_chat_state")
    .delete()
    .eq("telegram_chat_id", chatId);
  if (error) {
    console.error("[telegram/chat-state] clear failed", error);
  }
}
