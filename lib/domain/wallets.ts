import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Wallet } from "@/lib/supabase/database.types";

export type WalletWithBalance = {
  wallet: Wallet;
  balance: number;
};

type TypedClient = SupabaseClient<Database>;

interface GetWalletsOptions {
  includeArchived?: boolean;
}

/**
 * Fetch every wallet for `userId` together with its current balance.
 *
 * The balance is computed by summing the wallet's transactions in JS (one
 * grouped query) rather than calling `wallet_balance()` per row, so we stay at
 * O(2) round-trips no matter how many wallets the user owns. The Postgres
 * function exists for ad-hoc usage (Wave 4A onwards) and as a single-row
 * fallback in `getWalletById()`.
 *
 * Archived wallets are excluded by default — pass `includeArchived: true` to
 * include them (useful for an "archived" section in settings).
 */
export async function getWalletsWithBalance(
  supabase: TypedClient,
  userId: string,
  { includeArchived = false }: GetWalletsOptions = {},
): Promise<WalletWithBalance[]> {
  let walletsQuery = supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (!includeArchived) {
    walletsQuery = walletsQuery.eq("archived", false);
  }

  const { data: wallets, error: walletsError } = await walletsQuery;
  if (walletsError) throw walletsError;
  if (!wallets || wallets.length === 0) return [];

  const ids = wallets.map((w) => w.id);
  const { data: txs, error: txsError } = await supabase
    .from("transactions")
    .select("wallet_id, type, amount, transfer_direction")
    .eq("user_id", userId)
    .in("wallet_id", ids);
  if (txsError) throw txsError;

  const deltas = new Map<string, number>();
  for (const t of txs ?? []) {
    const current = deltas.get(t.wallet_id) ?? 0;
    if (t.type === "income") {
      deltas.set(t.wallet_id, current + Number(t.amount));
    } else if (t.type === "expense") {
      deltas.set(t.wallet_id, current - Number(t.amount));
    } else if (t.type === "transfer") {
      // Wave 4A — distinguish legs by `transfer_direction`. Each row holds a
      // positive amount; the direction decides the sign.
      const direction = (t as { transfer_direction?: string | null }).transfer_direction;
      if (direction === "in") {
        deltas.set(t.wallet_id, current + Number(t.amount));
      } else if (direction === "out") {
        deltas.set(t.wallet_id, current - Number(t.amount));
      }
    }
  }

  return wallets.map((wallet) => ({
    wallet,
    balance: Number(wallet.initial_balance) + (deltas.get(wallet.id) ?? 0),
  }));
}

/**
 * Fetch a single wallet by id, scoped to `userId`. Returns `null` when the
 * wallet doesn't exist or belongs to someone else.
 */
export async function getWalletById(
  supabase: TypedClient,
  id: string,
  userId: string,
): Promise<WalletWithBalance | null> {
  const { data: wallet, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!wallet) return null;

  const { data: txs, error: txsError } = await supabase
    .from("transactions")
    .select("type, amount, transfer_direction")
    .eq("wallet_id", id)
    .eq("user_id", userId);
  if (txsError) throw txsError;

  let delta = 0;
  for (const t of txs ?? []) {
    if (t.type === "income") {
      delta += Number(t.amount);
    } else if (t.type === "expense") {
      delta -= Number(t.amount);
    } else if (t.type === "transfer") {
      const direction = (t as { transfer_direction?: string | null }).transfer_direction;
      if (direction === "in") delta += Number(t.amount);
      else if (direction === "out") delta -= Number(t.amount);
    }
  }

  return {
    wallet,
    balance: Number(wallet.initial_balance) + delta,
  };
}

/**
 * Compute the next `position` value for a new wallet — `max(position) + 1` for
 * the user. Falls back to 0 when the user has no wallets yet.
 */
export async function getNextWalletPosition(
  supabase: TypedClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("wallets")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.position ?? -1) + 1;
}
