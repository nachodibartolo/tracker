import { tool } from "ai";
import { z } from "zod";

import { logAction } from "@/lib/ai/agent/action-log";
import { ExpenseItemSchema } from "@/lib/ai/schemas";
import { resolveCategory as defaultResolveCategory } from "@/lib/telegram/category-resolver";
import { deduplicateBatch as defaultDeduplicateBatch } from "@/lib/telegram/dedup";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface MovementsCtx {
  supabase: AdminClient;
  userId: string;
  chatId: number;
  mainCurrency: string;
  /** Override for tests; defaults to the real resolveCategory at runtime. */
  resolveCategory?: (
    type: "expense" | "income",
    hint: string | null,
    subHint?: string | null,
  ) => Promise<{ id: string | null; label: string }>;
  /** Override for tests; defaults to the real deduplicateBatch at runtime. */
  dedupBatch?: (
    walletId: string,
    items: z.infer<typeof ExpenseItemSchema>[],
  ) => Promise<{ batch_index: number; is_duplicate: boolean; duplicate_of_tx_id: string | null }[]>;
}

const CreateInput = z.object({
  items: z.array(ExpenseItemSchema).min(1).max(100),
  wallet_id: z.string().uuid(),
  photo_path: z.string().nullable().optional(),
});

interface CreateResult {
  created_count: number;
  ids: string[];
  dedup_warnings: { index: number; duplicate_of_tx_id: string | null }[];
}

export function createMovementsTool(ctx: MovementsCtx) {
  return tool({
    description:
      "Crea uno o más movimientos (gastos / ingresos / transferencias) en la wallet indicada. Llamala cuando el usuario describe un gasto, ingreso, o cuando una imagen muestra movimientos (ticket, screenshot de homebanking, feed de billetera).",
    inputSchema: CreateInput,
    execute: async (input): Promise<CreateResult> => {
      const items = input.items.filter(
        (i): i is typeof i & { amount: number } =>
          i.type !== "unknown" &&
          i.amount !== null &&
          i.amount > 0 &&
          i.confidence >= 0.4,
      );
      if (items.length === 0) {
        return { created_count: 0, ids: [], dedup_warnings: [] };
      }

      // Resolve categories.
      const resolveCategory =
        ctx.resolveCategory ??
        ((type, hint, subHint) =>
          defaultResolveCategory(ctx.supabase, ctx.userId, type, hint, subHint));

      const withCats = await Promise.all(
        items.map(async (item) => {
          const cat = await resolveCategory(
            item.type === "income" ? "income" : "expense",
            item.category_hint,
            item.subcategory_hint,
          );
          return { item, categoryId: cat.id };
        }),
      );

      // Dedup pass.
      const dedupBatch =
        ctx.dedupBatch ??
        ((walletId, dItems) =>
          defaultDeduplicateBatch(
            ctx.supabase,
            ctx.userId,
            walletId,
            dItems,
            "00000000-0000-0000-0000-000000000000",
          ));
      const dedup = await dedupBatch(input.wallet_id, items);
      const dupIndices = new Set(
        dedup.filter((d) => d.is_duplicate).map((d) => d.batch_index),
      );

      const toInsert = withCats
        .map((entry, idx) => ({ ...entry, idx }))
        .filter(({ idx }) => !dupIndices.has(idx));

      if (toInsert.length === 0) {
        return {
          created_count: 0,
          ids: [],
          dedup_warnings: dedup
            .filter((d) => d.is_duplicate)
            .map((d) => ({ index: d.batch_index, duplicate_of_tx_id: d.duplicate_of_tx_id })),
        };
      }

      const source: Database["public"]["Enums"]["tx_source"] = input.photo_path
        ? "telegram_photo"
        : "telegram_text";

      const rows = toInsert.map(({ item, categoryId }) => ({
        user_id: ctx.userId,
        wallet_id: input.wallet_id,
        category_id: categoryId,
        type: item.type as Database["public"]["Enums"]["tx_type"],
        amount: item.amount,
        currency: item.currency ?? ctx.mainCurrency,
        payee: item.payee,
        description: item.description,
        occurred_at: item.occurred_at ?? new Date().toISOString(),
        photo_path: input.photo_path ?? null,
        source,
      }));

      const { data: inserted, error } = await ctx.supabase
        .from("transactions")
        .insert(rows)
        .select("id");
      if (error || !inserted) {
        throw new Error(`create_movements insert failed: ${error?.message ?? "no rows"}`);
      }
      const ids = inserted.map((r) => r.id);

      await logAction(ctx.supabase, {
        userId: ctx.userId,
        chatId: ctx.chatId,
        actionType: "create",
        targetIds: ids,
        beforePayload: null,
        afterPayload: rows,
        agentSummary: `creó ${ids.length} movimiento${ids.length === 1 ? "" : "s"}`,
      });

      return {
        created_count: ids.length,
        ids,
        dedup_warnings: dedup
          .filter((d) => d.is_duplicate)
          .map((d) => ({ index: d.batch_index, duplicate_of_tx_id: d.duplicate_of_tx_id })),
      };
    },
  });
}
