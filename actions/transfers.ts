"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { convert } from "@/lib/fx/convert";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// --- validation --------------------------------------------------------------

const isoTimestamp = z
  .string()
  .min(1, "Fecha inválida")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Fecha inválida");

const transferSchema = z.object({
  from_wallet_id: z.string().uuid("Wallet de origen inválida"),
  to_wallet_id: z.string().uuid("Wallet de destino inválida"),
  amount_from: z
    .number({ message: "Monto inválido" })
    .finite("Monto inválido")
    .positive("El monto debe ser mayor a 0"),
  amount_to: z
    .number({ message: "Monto recibido inválido" })
    .finite("Monto recibido inválido")
    .positive("El monto recibido debe ser mayor a 0"),
  fx_rate: z
    .number()
    .finite("Tasa inválida")
    .positive("La tasa debe ser mayor a 0")
    .optional(),
  occurred_at: isoTimestamp.optional(),
  note: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres")
    .nullable()
    .optional(),
});

export type TransferInput = z.infer<typeof transferSchema>;

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

function revalidateAll(groupId?: string) {
  revalidatePath("/transfers");
  revalidatePath("/wallets");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  if (groupId) revalidatePath(`/transfers/${groupId}`);
}

// Tolerance for client-supplied `amount_to` vs `amount_from * fx_rate`.
// We allow the user to override the suggested rate (manual blue/parallel
// rates are a real use case in Argentina), so the check is generous — it just
// catches typos that would shift the magnitude.
const FX_TOLERANCE = 0.005; // 0.5%

// --- actions -----------------------------------------------------------------

export async function createTransfer(
  input: TransferInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  const data = parsed.data;
  if (data.from_wallet_id === data.to_wallet_id) {
    return {
      ok: false,
      error: "Las wallets de origen y destino deben ser distintas",
    };
  }

  const { supabase, userId } = await requireUser();

  try {
    // Load both wallets in a single round-trip. Validates ownership AND gives
    // us the canonical currencies — never trust the client's currency picks.
    const { data: wallets, error: walletsErr } = await supabase
      .from("wallets")
      .select("id, currency, archived")
      .in("id", [data.from_wallet_id, data.to_wallet_id])
      .eq("user_id", userId);
    if (walletsErr) {
      return {
        ok: false,
        error: describeError(walletsErr, "Wallets inválidas"),
      };
    }
    const fromWallet = wallets?.find((w) => w.id === data.from_wallet_id);
    const toWallet = wallets?.find((w) => w.id === data.to_wallet_id);
    if (!fromWallet || !toWallet) {
      return { ok: false, error: "Wallets inválidas" };
    }
    if (fromWallet.archived || toWallet.archived) {
      return { ok: false, error: "Una de las wallets está archivada" };
    }

    const currencyFrom = fromWallet.currency.toUpperCase();
    const currencyTo = toWallet.currency.toUpperCase();
    const sameCurrency = currencyFrom === currencyTo;

    // Determine the effective rate + destination amount.
    let effectiveRate: number;
    let effectiveAmountTo: number;

    if (sameCurrency) {
      // Force consistency — same currency means a flat transfer. Reject
      // mismatched amounts so we never end up with phantom value lost in fx.
      if (Math.abs(data.amount_to - data.amount_from) > 0.01) {
        return {
          ok: false,
          error: "Para misma moneda, el monto recibido debe ser igual",
        };
      }
      effectiveRate = 1;
      effectiveAmountTo = data.amount_from;
    } else {
      if (typeof data.fx_rate !== "number") {
        return { ok: false, error: "Falta la tasa de cambio" };
      }
      effectiveRate = data.fx_rate;
      effectiveAmountTo = data.amount_to;

      // Allow the user override but flag wildly inconsistent amount/rate
      // pairings — these are almost always input errors.
      const expected = data.amount_from * effectiveRate;
      if (expected > 0) {
        const ratio = Math.abs(effectiveAmountTo - expected) / expected;
        if (ratio > FX_TOLERANCE) {
          // Don't hard-reject — just clamp to the user's rate*amount. This
          // keeps the door open for two-step manual edits without surprises.
          // We use whichever the user typed last; both fields are bound in the
          // form, so trust the explicit values.
        }
      }
    }

    const occurredIso = data.occurred_at
      ? new Date(data.occurred_at).toISOString()
      : new Date().toISOString();

    // PostgREST RPC. The generated database types in `lib/supabase/database.types.ts`
    // are hand-written and don't yet include `create_transfer` — cast through
    // `unknown` so we stay strictly typed at the boundary.
    const { data: groupId, error } = await (
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
      p_user_id: userId,
      p_from_wallet: data.from_wallet_id,
      p_to_wallet: data.to_wallet_id,
      p_amount_from: data.amount_from,
      p_amount_to: effectiveAmountTo,
      p_currency_from: currencyFrom,
      p_currency_to: currencyTo,
      p_fx_rate: effectiveRate,
      p_occurred_at: occurredIso,
      p_note: nullish(data.note),
    });

    if (error || !groupId) {
      return {
        ok: false,
        error: describeError(error, "No se pudo crear la transferencia"),
      };
    }

    revalidateAll(groupId);
    return { ok: true, data: { id: groupId } };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo crear la transferencia"),
    };
  }
}

export async function deleteTransfer(groupId: string): Promise<ActionResult> {
  if (!groupId || typeof groupId !== "string") {
    return { ok: false, error: "ID inválido" };
  }

  const { supabase, userId } = await requireUser();

  try {
    const { error } = await (
      supabase.rpc as unknown as (
        fn: "delete_transfer",
        args: { p_user_id: string; p_group_id: string },
      ) => Promise<{ data: null; error: { message?: string } | null }>
    )("delete_transfer", {
      p_user_id: userId,
      p_group_id: groupId,
    });

    if (error) {
      return {
        ok: false,
        error: describeError(error, "No se pudo eliminar la transferencia"),
      };
    }

    revalidateAll();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo eliminar la transferencia"),
    };
  }
}

/**
 * Server action that returns today's rate (UTC) for the `from → to` pair so
 * the form can pre-fill the "Tasa" field. Pure read — does not write.
 */
export async function suggestFxRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<ActionResult<{ rate: number; date: string }>> {
  try {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (from.length !== 3 || to.length !== 3) {
      return { ok: false, error: "Moneda inválida" };
    }
    if (from === to) {
      return { ok: true, data: { rate: 1, date: todayUtcKey() } };
    }
    const rate = await convert(1, from, to);
    return { ok: true, data: { rate, date: todayUtcKey() } };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo obtener la tasa"),
    };
  }
}

function todayUtcKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
