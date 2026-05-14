"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { DEFAULT_COLOR, PALETTE } from "@/lib/colors";
import { getNextWalletPosition } from "@/lib/domain/wallets";
import { createClient } from "@/lib/supabase/server";
import type { Wallet, WalletType } from "@/lib/supabase/database.types";
import { WALLET_ICON_NAMES } from "@/lib/wallet-icons";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// --- validation --------------------------------------------------------------

const WALLET_TYPES = [
  "general",
  "cash",
  "bank",
  "credit_card",
  "savings",
  "investment",
] as const satisfies readonly WalletType[];

const PALETTE_SET = new Set(PALETTE.map((c) => c.toLowerCase()));
const ICON_SET = new Set(WALLET_ICON_NAMES);

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color inválido")
  .transform((v) => v.toLowerCase())
  .refine((v) => PALETTE_SET.has(v), "Color fuera de la paleta");

const walletInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(40, "Máximo 40 caracteres"),
  type: z.enum(WALLET_TYPES),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Moneda inválida (ISO 4217)"),
  initial_balance: z
    .number({ message: "Saldo inválido" })
    .finite("Saldo inválido"),
  color: hexColor,
  icon: z
    .string()
    .min(1)
    .refine((v) => ICON_SET.has(v), "Ícono inválido"),
  excluded_from_stats: z.boolean(),
});

const walletPatchSchema = walletInputSchema.partial();

export type WalletInput = z.infer<typeof walletInputSchema>;
export type WalletPatch = z.infer<typeof walletPatchSchema>;

// --- helpers -----------------------------------------------------------------

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: string }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return fallback;
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

function revalidateWalletRoutes() {
  revalidatePath("/wallets");
  revalidatePath("/dashboard");
}

// --- actions -----------------------------------------------------------------

export async function createWallet(
  input: unknown,
): Promise<ActionResult<Wallet>> {
  const parsed = walletInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  const { supabase, userId } = await requireUser();
  const data = parsed.data;

  try {
    const position = await getNextWalletPosition(supabase, userId);

    const { data: row, error } = await supabase
      .from("wallets")
      .insert({
        user_id: userId,
        name: data.name,
        type: data.type,
        currency: data.currency,
        initial_balance: data.initial_balance,
        color: data.color || DEFAULT_COLOR,
        icon: data.icon,
        excluded_from_stats: data.excluded_from_stats,
        position,
      })
      .select("*")
      .single();

    if (error) {
      return { ok: false, error: describeError(error, "No se pudo crear la wallet") };
    }

    revalidateWalletRoutes();
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo crear la wallet"),
    };
  }
}

export async function updateWallet(
  id: string,
  input: unknown,
): Promise<ActionResult<Wallet>> {
  if (!id) return { ok: false, error: "ID inválido" };

  const parsed = walletPatchSchema.safeParse(input);
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
    const { data: row, error } = await supabase
      .from("wallets")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      return { ok: false, error: describeError(error, "No se pudo actualizar la wallet") };
    }

    revalidateWalletRoutes();
    revalidatePath(`/wallets/${id}`);
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo actualizar la wallet"),
    };
  }
}

async function setArchived(
  id: string,
  archived: boolean,
): Promise<ActionResult<Wallet>> {
  if (!id) return { ok: false, error: "ID inválido" };

  const { supabase, userId } = await requireUser();
  try {
    const { data: row, error } = await supabase
      .from("wallets")
      .update({ archived })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      return {
        ok: false,
        error: describeError(
          error,
          archived ? "No se pudo archivar" : "No se pudo desarchivar",
        ),
      };
    }

    revalidateWalletRoutes();
    revalidatePath(`/wallets/${id}`);
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: describeError(
        err,
        archived ? "No se pudo archivar" : "No se pudo desarchivar",
      ),
    };
  }
}

export async function archiveWallet(id: string): Promise<ActionResult<Wallet>> {
  return setArchived(id, true);
}

export async function unarchiveWallet(
  id: string,
): Promise<ActionResult<Wallet>> {
  return setArchived(id, false);
}

export async function deleteWallet(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido" };

  const { supabase, userId } = await requireUser();

  try {
    const { error } = await supabase
      .from("wallets")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      // Postgres FK violation when transactions reference the wallet.
      // (See migration 0001: transactions.wallet_id ON DELETE RESTRICT.)
      if (error.code === "23503") {
        return { ok: false, error: "La wallet tiene transacciones" };
      }
      return { ok: false, error: describeError(error, "No se pudo eliminar la wallet") };
    }

    revalidateWalletRoutes();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: describeError(err, "No se pudo eliminar la wallet"),
    };
  }
}
