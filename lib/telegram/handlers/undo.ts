// /deshacer command — reverses the last unreverted agent write.

import type { Bot, CommandContext, Context } from "grammy";

import {
  getLastReversibleAction,
  markReversed,
} from "@/lib/ai/agent/action-log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const NOTHING_TEXT = "No hay nada para deshacer.";
const RACE_TEXT = "Ya estaba deshecho.";
const FAIL_TEXT =
  "No pude deshacer: la transacción ya no existe o cambió desde entonces.";

export type UndoResult =
  | { kind: "nothing" }
  | { kind: "race" }
  | { kind: "fail" }
  | { kind: "ok"; summary: string };

export async function reverseLastAction(
  supabase: AdminClient,
  userId: string,
): Promise<UndoResult> {
  const action = await getLastReversibleAction(supabase, userId);
  if (!action) return { kind: "nothing" };

  try {
    if (action.action_type === "create") {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .in("id", action.target_ids)
        .eq("user_id", userId);
      if (error) {
        console.error("[undo] create reverse failed", error);
        return { kind: "fail" };
      }
    } else if (action.action_type === "update") {
      const before = action.before_payload as Record<string, unknown> | null;
      if (!before || typeof before !== "object") return { kind: "fail" };
      const targetId = action.target_ids[0];
      const { error } = await supabase
        .from("transactions")
        .update(before as never)
        .eq("id", targetId)
        .eq("user_id", userId);
      if (error) {
        console.error("[undo] update reverse failed", error);
        return { kind: "fail" };
      }
    } else if (action.action_type === "delete") {
      const before = action.before_payload as Record<string, unknown> | null;
      if (!before || typeof before !== "object") return { kind: "fail" };
      const { error } = await supabase
        .from("transactions")
        .insert(before as never);
      if (error) {
        console.error("[undo] delete reverse failed", error);
        return { kind: "fail" };
      }
    }
  } catch (err) {
    console.error("[undo] unexpected", err);
    return { kind: "fail" };
  }

  const marked = await markReversed(supabase, action.id);
  if (!marked) return { kind: "race" };
  return { kind: "ok", summary: action.agent_summary ?? "última acción" };
}

export function registerUndoHandler(bot: Bot): void {
  bot.command("deshacer", handleUndo);
}

async function handleUndo(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }
  const supabase = createAdminClient();
  const res = await reverseLastAction(supabase, linked.user_id);
  switch (res.kind) {
    case "nothing":
      await ctx.reply(NOTHING_TEXT);
      return;
    case "race":
      await ctx.reply(RACE_TEXT);
      return;
    case "fail":
      await ctx.reply(FAIL_TEXT);
      return;
    case "ok":
      await ctx.reply(`↩️ Deshecho: ${res.summary} → revertido.`);
      return;
  }
}
