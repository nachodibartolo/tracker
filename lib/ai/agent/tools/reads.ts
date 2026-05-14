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

// -- get_balance -----------------------------------------------------------

const GetBalanceInput = z.object({
  wallet_id: z.string().uuid().optional(),
});

export function getBalanceTool(ctx: ReadCtx) {
  return tool({
    description:
      "Devuelve el balance por wallet del usuario. Si pasás wallet_id, solo esa wallet.",
    inputSchema: GetBalanceInput,
    execute: async (input) => {
      const { data: wallets, error: wErr } = await ctx.supabase
        .from("wallets")
        .select("id, name, currency, initial_balance")
        .eq("user_id", ctx.userId)
        .eq("archived", false)
        .eq("excluded_from_stats", false);
      if (wErr) throw new Error(`get_balance: ${wErr.message}`);
      const walletList = wallets ?? [];
      const ids = walletList.map((w) => w.id);
      if (ids.length === 0) return { wallets: [] };

      let txQuery = ctx.supabase
        .from("transactions")
        .select("wallet_id, type, amount, counterpart_wallet_id, counterpart_amount")
        .eq("user_id", ctx.userId)
        .in("wallet_id", ids);
      if (input.wallet_id) txQuery = txQuery.eq("wallet_id", input.wallet_id);
      const { data: txs, error: tErr } = await txQuery;
      if (tErr) throw new Error(`get_balance: ${tErr.message}`);

      const balance = new Map<string, number>();
      for (const w of walletList) balance.set(w.id, Number(w.initial_balance));
      for (const t of txs ?? []) {
        const wid = t.wallet_id;
        const cur = balance.get(wid) ?? 0;
        if (t.type === "income") balance.set(wid, cur + Number(t.amount));
        else if (t.type === "expense") balance.set(wid, cur - Number(t.amount));
        else if (t.type === "transfer") {
          balance.set(wid, cur - Number(t.amount));
          if (t.counterpart_wallet_id && balance.has(t.counterpart_wallet_id)) {
            const cv = balance.get(t.counterpart_wallet_id) ?? 0;
            balance.set(
              t.counterpart_wallet_id,
              cv + Number(t.counterpart_amount ?? t.amount),
            );
          }
        }
      }

      const out = walletList
        .filter((w) => !input.wallet_id || w.id === input.wallet_id)
        .map((w) => ({
          id: w.id,
          name: w.name,
          currency: w.currency,
          balance: balance.get(w.id) ?? Number(w.initial_balance),
        }));
      return { wallets: out };
    },
  });
}

// -- search_transactions ---------------------------------------------------

const SearchInput = z.object({
  query: z.string().optional(),
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
  type: z.enum(["expense", "income", "transfer"]).optional(),
  wallet_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function searchTransactionsTool(ctx: ReadCtx) {
  return tool({
    description:
      "Busca transacciones del usuario por texto (description/payee), rango de fechas, tipo, wallet o categoría. Máximo 50 rows.",
    inputSchema: SearchInput,
    execute: async (input) => {
      let q = ctx.supabase
        .from("transactions")
        .select(
          "id, amount, currency, type, occurred_at, payee, description, wallet_id, category_id",
        )
        .eq("user_id", ctx.userId)
        .order("occurred_at", { ascending: false })
        .limit(input.limit ?? 20);
      if (input.query) {
        const safe = input.query.replace(/[%_]/g, "\\$&");
        q = q.or(`payee.ilike.%${safe}%,description.ilike.%${safe}%`);
      }
      if (input.date_from) q = q.gte("occurred_at", input.date_from);
      if (input.date_to) q = q.lte("occurred_at", input.date_to);
      if (input.type) q = q.eq("type", input.type);
      if (input.wallet_id) q = q.eq("wallet_id", input.wallet_id);
      if (input.category_id) q = q.eq("category_id", input.category_id);
      const { data, error } = await q;
      if (error) throw new Error(`search_transactions: ${error.message}`);
      return data ?? [];
    },
  });
}

// -- get_spend_by_category -------------------------------------------------

const GetSpendInput = z.object({
  date_from: z.string().datetime({ offset: true }),
  date_to: z.string().datetime({ offset: true }),
  type: z.enum(["expense", "income"]).optional(),
});

export function getSpendByCategoryTool(ctx: ReadCtx) {
  return tool({
    description:
      "Devuelve total y count por categoría en un rango de fechas. Default type = expense.",
    inputSchema: GetSpendInput,
    execute: async (input) => {
      const type = input.type ?? "expense";
      const { data, error } = await ctx.supabase
        .from("transactions")
        .select("category_id, amount")
        .eq("user_id", ctx.userId)
        .eq("type", type)
        .gte("occurred_at", input.date_from)
        .lte("occurred_at", input.date_to);
      if (error) throw new Error(`get_spend_by_category: ${error.message}`);

      const agg = new Map<string | null, { total: number; count: number }>();
      for (const r of data ?? []) {
        const k = r.category_id;
        const cur = agg.get(k) ?? { total: 0, count: 0 };
        cur.total += Number(r.amount);
        cur.count += 1;
        agg.set(k, cur);
      }

      const catIds = [...agg.keys()].filter((k): k is string => !!k);
      let names = new Map<string, string>();
      if (catIds.length > 0) {
        const { data: cats } = await ctx.supabase
          .from("categories")
          .select("id, name")
          .in("id", catIds);
        for (const c of cats ?? []) names.set(c.id, c.name);
      }
      return [...agg.entries()].map(([id, v]) => ({
        category_id: id,
        category_name: id ? (names.get(id) ?? "?") : "Sin categoría",
        total: v.total,
        count: v.count,
      }));
    },
  });
}
