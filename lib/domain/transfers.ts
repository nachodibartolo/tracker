import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Wallet } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

/**
 * One transfer (= one `transfer_group_id`) flattened into a single row shape
 * suitable for the UI. Built by reading the OUT leg from `transactions` and
 * joining the destination wallet via `counterpart_wallet_id`.
 *
 * `id` is the `transfer_group_id` rather than either tx id — deletes operate
 * on the group, and Track 4B can use it as a stable key.
 */
export interface TransferWalletRef {
  id: string;
  name: string;
  currency: string;
  color: string;
  icon: string;
}

export interface TransferRow {
  /** transfer_group_id — stable id for the whole transfer. */
  id: string;
  fromWallet: TransferWalletRef;
  toWallet: TransferWalletRef;
  amountFrom: number;
  currencyFrom: string;
  amountTo: number;
  currencyTo: string;
  fxRate: number | null;
  occurredAt: string;
  note: string | null;
  createdAt: string;
}

export interface ListTransfersFilters {
  /** Inclusive lower bound, ISO date (yyyy-mm-dd) or ISO timestamp. */
  fromDate?: string;
  /** Inclusive upper bound. */
  toDate?: string;
}

export interface ListTransfersResult {
  rows: TransferRow[];
  total: number;
}

const PAGE_SIZE = 50;

export const TRANSFERS_PAGE_SIZE = PAGE_SIZE;

/**
 * Selects only the OUT leg (`transfer_direction = 'out'`) so each transfer
 * yields exactly one row. The counterpart wallet metadata is joined via the
 * `transactions_counterpart_wallet_id_fkey` FK, and the destination amount/
 * currency are read from the same OUT row's counterpart columns.
 *
 * Doing it this way means we issue a single query instead of joining the two
 * legs together — the OUT row already contains everything we need.
 */
const TRANSFER_SELECT = `
  id,
  transfer_group_id,
  amount,
  currency,
  counterpart_amount,
  counterpart_currency,
  fx_rate,
  occurred_at,
  note,
  created_at,
  from_wallet:wallets!transactions_wallet_id_fkey ( id, name, currency, color, icon ),
  to_wallet:wallets!transactions_counterpart_wallet_id_fkey ( id, name, currency, color, icon )
`;

interface RawTransferRow {
  id: string;
  transfer_group_id: string | null;
  amount: number;
  currency: string;
  counterpart_amount: number | null;
  counterpart_currency: string | null;
  fx_rate: number | null;
  occurred_at: string;
  note: string | null;
  created_at: string;
  from_wallet: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon"> | null;
  to_wallet: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon"> | null;
}

function toTransferRow(raw: RawTransferRow): TransferRow | null {
  if (!raw.transfer_group_id || !raw.from_wallet || !raw.to_wallet) return null;
  return {
    id: raw.transfer_group_id,
    fromWallet: raw.from_wallet,
    toWallet: raw.to_wallet,
    amountFrom: Number(raw.amount),
    currencyFrom: raw.currency,
    amountTo: Number(raw.counterpart_amount ?? raw.amount),
    currencyTo: raw.counterpart_currency ?? raw.currency,
    fxRate: raw.fx_rate === null ? null : Number(raw.fx_rate),
    occurredAt: raw.occurred_at,
    note: raw.note,
    createdAt: raw.created_at,
  };
}

/**
 * Paginated transfer list for `userId`. One row per transfer group, ordered by
 * `occurred_at desc` with `id` as a stable tiebreaker.
 */
export async function listTransfers(
  supabase: TypedClient,
  userId: string,
  filters: ListTransfersFilters = {},
  page: number = 0,
): Promise<ListTransfersResult> {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
  const from = safePage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("transactions")
    .select(TRANSFER_SELECT, { count: "exact" })
    .eq("user_id", userId)
    .eq("type", "transfer")
    .eq("transfer_direction", "out")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.fromDate) query = query.gte("occurred_at", filters.fromDate);
  if (filters.toDate) query = query.lte("occurred_at", filters.toDate);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as RawTransferRow[])
    .map(toTransferRow)
    .filter((row): row is TransferRow => row !== null);

  return { rows, total: count ?? 0 };
}

/**
 * Fetch a single transfer by its `transfer_group_id`, scoped to `userId`.
 * Returns `null` when the group doesn't exist or belongs to another user.
 */
export async function getTransferByGroupId(
  supabase: TypedClient,
  userId: string,
  groupId: string,
): Promise<TransferRow | null> {
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSFER_SELECT)
    .eq("user_id", userId)
    .eq("transfer_group_id", groupId)
    .eq("transfer_direction", "out")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return toTransferRow(data as unknown as RawTransferRow);
}

export interface TransferDayGroup {
  /** YYYY-MM-DD (UTC) key for the day. */
  day: string;
  rows: TransferRow[];
}

/**
 * Group transfers by UTC day (YYYY-MM-DD). Mirrors `groupByDay` in
 * `lib/domain/transactions.ts` so the UI patterns can stay parallel.
 */
export function groupTransfersByDay(rows: TransferRow[]): TransferDayGroup[] {
  const groups: TransferDayGroup[] = [];
  const indexByDay = new Map<string, number>();

  for (const row of rows) {
    const day = row.occurredAt.slice(0, 10);
    const existing = indexByDay.get(day);
    if (existing === undefined) {
      indexByDay.set(day, groups.length);
      groups.push({ day, rows: [row] });
    } else {
      groups[existing]!.rows.push(row);
    }
  }

  return groups;
}
