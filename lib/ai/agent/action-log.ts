import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export type ActionType = "create" | "update" | "delete";

export interface LogActionInput {
  userId: string;
  chatId: number;
  actionType: ActionType;
  targetIds: string[];
  beforePayload: unknown;
  afterPayload: unknown;
  agentSummary: string;
}

export async function logAction(
  supabase: AdminClient,
  input: LogActionInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("telegram_agent_actions")
    .insert({
      user_id: input.userId,
      telegram_chat_id: input.chatId,
      action_type: input.actionType,
      target_table: "transactions",
      target_ids: input.targetIds,
      before_payload: input.beforePayload as never,
      after_payload: input.afterPayload as never,
      agent_summary: input.agentSummary,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`logAction failed: ${error?.message ?? "no row returned"}`);
  }
  return data.id;
}

export interface ReversibleAction {
  id: string;
  action_type: ActionType;
  target_ids: string[];
  before_payload: unknown;
  after_payload: unknown;
  agent_summary: string | null;
}

export async function getLastReversibleAction(
  supabase: AdminClient,
  userId: string,
): Promise<ReversibleAction | null> {
  const { data, error } = await supabase
    .from("telegram_agent_actions")
    .select(
      "id, action_type, target_ids, before_payload, after_payload, agent_summary",
    )
    .eq("user_id", userId)
    .is("reversed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`getLastReversibleAction failed: ${error.message}`);
  }
  if (!data) return null;
  return data as ReversibleAction;
}

/**
 * Marks an action as reversed atomically. Returns `true` if THIS call did the
 * marking; `false` if another concurrent call beat us (so the caller should
 * report "ya estaba deshecho" instead of running the reversal again).
 */
export async function markReversed(
  supabase: AdminClient,
  actionId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("telegram_agent_actions")
    .update({ reversed_at: new Date().toISOString() })
    .eq("id", actionId)
    .is("reversed_at", null)
    .select("id");
  if (error) {
    throw new Error(`markReversed failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
