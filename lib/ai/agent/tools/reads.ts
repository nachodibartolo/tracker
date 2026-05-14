import { tool } from "ai";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface ReadCtx {
  supabase: AdminClient;
  userId: string;
}

// -- list_wallets ----------------------------------------------------------

const ListWalletsInput = z.object({
  include_archived: z.boolean().optional(),
});

export function listWalletsTool(ctx: ReadCtx) {
  return tool({
    description: "Devuelve las wallets del usuario (id, name, currency).",
    inputSchema: ListWalletsInput,
    execute: async (input) => {
      let q = ctx.supabase
        .from("wallets")
        .select("id, name, currency, archived")
        .eq("user_id", ctx.userId)
        .order("position", { ascending: true });
      if (!input.include_archived) q = q.eq("archived", false);
      const { data, error } = await q;
      if (error) throw new Error(`list_wallets failed: ${error.message}`);
      return data ?? [];
    },
  });
}

// -- list_categories -------------------------------------------------------

const ListCategoriesInput = z.object({
  type: z.enum(["expense", "income"]).optional(),
});

export function listCategoriesTool(ctx: ReadCtx) {
  return tool({
    description:
      "Devuelve las categorías del usuario (id, name, type, parent_id). Filtrable por tipo.",
    inputSchema: ListCategoriesInput,
    execute: async (input) => {
      let q = ctx.supabase
        .from("categories")
        .select("id, name, type, parent_id")
        .eq("user_id", ctx.userId);
      if (input.type) q = q.eq("type", input.type);
      const { data, error } = await q;
      if (error) throw new Error(`list_categories failed: ${error.message}`);
      return data ?? [];
    },
  });
}

// -- list_recent -----------------------------------------------------------

const ListRecentInput = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  type: z.enum(["expense", "income", "transfer"]).optional(),
  wallet_id: z.string().uuid().optional(),
});

export function listRecentTool(ctx: ReadCtx) {
  return tool({
    description:
      "Lista las últimas N transacciones del usuario. Default 5, máximo 20.",
    inputSchema: ListRecentInput,
    execute: async (input) => {
      const limit = input.limit ?? 5;
      let q = ctx.supabase
        .from("transactions")
        .select(
          "id, amount, currency, type, occurred_at, payee, description, wallet_id, category_id",
        )
        .eq("user_id", ctx.userId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (input.type) q = q.eq("type", input.type);
      if (input.wallet_id) q = q.eq("wallet_id", input.wallet_id);
      const { data, error } = await q;
      if (error) throw new Error(`list_recent failed: ${error.message}`);
      return data ?? [];
    },
  });
}
