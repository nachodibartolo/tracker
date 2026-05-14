"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type {
  Transaction,
  TransactionUpdate,
} from "@/lib/supabase/database.types";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// --- validation --------------------------------------------------------------

// Wave 3 scope: only expense + income. Transfers come from Wave 4A via a
// dedicated action — we reject them here to keep wallet-balance semantics
// consistent.
const TX_TYPES = ["expense", "income"] as const;

const isoTimestamp = z
  .string()
  .min(1, "Fecha inválida")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Fecha inválida");

const baseSchema = z.object({
  wallet_id: z.string().uuid("Wallet inválida"),
  category_id: z.string().uuid("Categoría inválida").nullable().optional(),
  type: z.enum(TX_TYPES),
  amount: z
    .number({ message: "Monto inválido" })
    .finite("Monto inválido")
    .positive("El monto debe ser mayor a 0"),
  occurred_at: isoTimestamp,
  description: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres")
    .nullable()
    .optional(),
  note: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres")
    .nullable()
    .optional(),
  payee: z
    .string()
    .trim()
    .max(100, "Máximo 100 caracteres")
    .nullable()
    .optional(),
  photo_path: z
    .string()
    .trim()
    .max(300, "Ruta inválida")
    .nullable()
    .optional(),
});

const createSchema = baseSchema;
const patchSchema = baseSchema.partial();

export type CreateTransactionInput = z.infer<typeof createSchema>;
export type UpdateTransactionInput = z.infer<typeof patchSchema>;

// --- helpers -----------------------------------------------------------------

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: string }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return fallback;
}

function nullish(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return { supabase, userId: user.id };
}

function revalidateRoutes(id?: string) {
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/transactions/${id}`);
}

// --- actions -----------------------------------------------------------------

export async function createTransaction(
  input: unknown,
): Promise<ActionResult<Transaction>> {
  // Pre-emptively reject transfers — they need counterpart fields and live in
  // Wave 4A's dedicated `createTransfer` action.
  if (
    input &&
    typeof input === "object" &&
    "type" in (input as Record<string, unknown>) &&
    (input as { type?: unknown }).type === "transfer"
  ) {
    return { ok: false, error: "Las transferencias se crean en otra acción" };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  const { supabase, userId } = await requireUser();
  const data = parsed.data;

  try {
    // Currency is derived from the wallet — never trust the client.
    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("id, user_id, currency, archived")
      .eq("id", data.wallet_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (walletErr) {
      return { ok: false, error: describeError(walletErr, "Wallet inválida") };
    }
    if (!wallet) {
      return { ok: false, error: "Wallet inválida" };
    }
    if (wallet.archived) {
      return { ok: false, error: "La wallet está archivada" };
    }

    // Category — if supplied, must belong to the user AND match the tx type.
    if (data.category_id) {
      const { data: cat, error: catErr } = await supabase
        .from("categories")
        .select("id, user_id, type")
        .eq("id", data.category_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (catErr) {
        return { ok: false, error: describeError(catErr, "Categoría inválida") };
      }
      if (!cat) {
        return { ok: false, error: "Categoría inválida" };
      }
      if (cat.type !== data.type) {
        return { ok: false, error: "La categoría no coincide con el tipo" };
      }
    }

    const { data: row, error } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        wallet_id: data.wallet_id,
        category_id: data.category_id ?? null,
        type: data.type,
        amount: data.amount,
        currency: wallet.currency,
        occurred_at: new Date(data.occurred_at).toISOString(),
        description: nullish(data.description),
        note: nullish(data.note),
        payee: nullish(data.payee),
        photo_path: nullish(data.photo_path),
        source: "manual",
      })
      .select("*")
      .single();

    if (error || !row) {
      return {
        ok: false,
        error: describeError(error, "No se pudo crear la transacción"),
      };
    }

    revalidateRoutes(row.id);
    revalidatePath(`/wallets/${row.wallet_id}`);
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo crear la transacción"),
    };
  }
}

export async function updateTransaction(
  id: string,
  input: unknown,
): Promise<ActionResult<Transaction>> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "ID inválido" };
  }
  // Same transfer guard as create.
  if (
    input &&
    typeof input === "object" &&
    "type" in (input as Record<string, unknown>) &&
    (input as { type?: unknown }).type === "transfer"
  ) {
    return { ok: false, error: "Las transferencias se editan en otra acción" };
  }

  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nada que actualizar" };
  }

  const { supabase, userId } = await requireUser();

  try {
    const { data: current, error: loadErr } = await supabase
      .from("transactions")
      .select("id, user_id, wallet_id, type, currency")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (loadErr || !current) {
      return { ok: false, error: "Transacción no encontrada" };
    }
    // Don't let callers convert a regular tx into a transfer or vice-versa.
    if (current.type === "transfer") {
      return { ok: false, error: "No se puede editar una transferencia aquí" };
    }

    const update: TransactionUpdate = {};
    let newCurrency = current.currency;

    if (patch.wallet_id !== undefined && patch.wallet_id !== current.wallet_id) {
      const { data: wallet, error: walletErr } = await supabase
        .from("wallets")
        .select("id, currency, archived")
        .eq("id", patch.wallet_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (walletErr || !wallet) {
        return { ok: false, error: "Wallet inválida" };
      }
      if (wallet.archived) {
        return { ok: false, error: "La wallet está archivada" };
      }
      update.wallet_id = patch.wallet_id;
      update.currency = wallet.currency;
      newCurrency = wallet.currency;
    }

    const newType = patch.type ?? current.type;

    if (patch.category_id !== undefined) {
      if (patch.category_id) {
        const { data: cat, error: catErr } = await supabase
          .from("categories")
          .select("id, type")
          .eq("id", patch.category_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (catErr || !cat) {
          return { ok: false, error: "Categoría inválida" };
        }
        if (cat.type !== newType) {
          return { ok: false, error: "La categoría no coincide con el tipo" };
        }
        update.category_id = patch.category_id;
      } else {
        update.category_id = null;
      }
    }

    if (patch.type !== undefined) update.type = patch.type;
    if (patch.amount !== undefined) update.amount = patch.amount;
    if (patch.occurred_at !== undefined) {
      update.occurred_at = new Date(patch.occurred_at).toISOString();
    }
    if (patch.description !== undefined) update.description = nullish(patch.description);
    if (patch.note !== undefined) update.note = nullish(patch.note);
    if (patch.payee !== undefined) update.payee = nullish(patch.payee);
    if (patch.photo_path !== undefined) update.photo_path = nullish(patch.photo_path);

    // Suppress unused-var hint: `newCurrency` may not feed back into `update`
    // when the wallet hasn't changed.
    void newCurrency;

    const { data: row, error } = await supabase
      .from("transactions")
      .update(update)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error || !row) {
      return {
        ok: false,
        error: describeError(error, "No se pudo actualizar la transacción"),
      };
    }

    revalidateRoutes(row.id);
    revalidatePath(`/wallets/${row.wallet_id}`);
    if (patch.wallet_id !== undefined && patch.wallet_id !== current.wallet_id) {
      revalidatePath(`/wallets/${current.wallet_id}`);
    }
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo actualizar la transacción"),
    };
  }
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "ID inválido" };
  }

  const { supabase, userId } = await requireUser();

  try {
    // Read the row first so we know the wallet and the photo to clean up.
    const { data: current, error: loadErr } = await supabase
      .from("transactions")
      .select("id, wallet_id, photo_path, type")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (loadErr || !current) {
      return { ok: false, error: "Transacción no encontrada" };
    }
    if (current.type === "transfer") {
      return { ok: false, error: "No se puede borrar una transferencia aquí" };
    }

    const { error: deleteErr } = await supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (deleteErr) {
      return {
        ok: false,
        error: describeError(deleteErr, "No se pudo eliminar la transacción"),
      };
    }

    // Best-effort photo cleanup. RLS limits what we can touch, so a failure
    // here doesn't undo the row delete — we just toast a warning at the call
    // site if it ever matters.
    if (current.photo_path) {
      await supabase.storage.from("receipts").remove([current.photo_path]);
    }

    revalidateRoutes();
    revalidatePath(`/wallets/${current.wallet_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo eliminar la transacción"),
    };
  }
}
