import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Category,
  Database,
  Transaction,
  TxType,
  Wallet,
} from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

/**
 * A transaction row joined with the wallet + category metadata we need to
 * render rows and detail screens without N+1 lookups.
 *
 * Only the small subset of wallet/category fields actually used by the UI is
 * exposed — keeping the join payload narrow makes the Supabase select string
 * easier to audit and reduces over-fetching.
 */
export type TransactionWithRefs = Transaction & {
  wallet: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">;
  category: Pick<Category, "id" | "name" | "color" | "icon"> | null;
};

export interface ListTransactionsFilters {
  walletId?: string;
  categoryId?: string;
  type?: TxType;
  /** Inclusive lower bound, ISO date (yyyy-mm-dd) or ISO timestamp. */
  fromDate?: string;
  /** Inclusive upper bound. */
  toDate?: string;
  /** Free-text search over description + payee. */
  q?: string;
}

export interface ListTransactionsResult {
  rows: TransactionWithRefs[];
  total: number;
}

const PAGE_SIZE = 50;

const TX_SELECT = `
  *,
  wallet:wallets!transactions_wallet_id_fkey ( id, name, currency, color, icon ),
  category:categories!transactions_category_id_fkey ( id, name, color, icon )
`;

/**
 * Fetch paginated transactions for `userId` with optional filters, returning
 * the rows plus the unfiltered-by-pagination total so callers can render
 * "page X of Y" controls.
 *
 * Pagination is 50 rows/page (0-indexed). The query is ordered by
 * `occurred_at DESC` with a stable tiebreaker on `id` so cursor reads are
 * deterministic.
 */
export async function listTransactions(
  supabase: TypedClient,
  userId: string,
  filters: ListTransactionsFilters = {},
  page: number = 0,
): Promise<ListTransactionsResult> {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
  const from = safePage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("transactions")
    .select(TX_SELECT, { count: "exact" })
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.walletId) query = query.eq("wallet_id", filters.walletId);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.fromDate) query = query.gte("occurred_at", filters.fromDate);
  if (filters.toDate) query = query.lte("occurred_at", filters.toDate);

  if (filters.q) {
    // Search description OR payee. `.or()` accepts a comma-separated string
    // of PostgREST conditions; escape commas and parens in user input.
    const term = filters.q.replace(/[,()]/g, " ").trim();
    if (term.length > 0) {
      const ilike = `*${term}*`;
      query = query.or(`description.ilike.${ilike},payee.ilike.${ilike}`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as TransactionWithRefs[];
  return { rows, total: count ?? 0 };
}

export const TRANSACTIONS_PAGE_SIZE = PAGE_SIZE;

/**
 * Fetch a single transaction (with wallet + category refs), scoped to `userId`.
 * Returns null when the row doesn't exist or belongs to another user.
 */
export async function getTransactionById(
  supabase: TypedClient,
  userId: string,
  id: string,
): Promise<TransactionWithRefs | null> {
  const { data, error } = await supabase
    .from("transactions")
    .select(TX_SELECT)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data as unknown as TransactionWithRefs;
}

export interface TransactionDayGroup {
  /** YYYY-MM-DD (UTC) key for the day. */
  day: string;
  rows: TransactionWithRefs[];
}

/**
 * Group transactions by UTC day (YYYY-MM-DD). Preserves the input order
 * within each day. Used to render sticky day headers in the list UI.
 */
export function groupByDay(rows: TransactionWithRefs[]): TransactionDayGroup[] {
  const groups: TransactionDayGroup[] = [];
  const indexByDay = new Map<string, number>();

  for (const row of rows) {
    const day = row.occurred_at.slice(0, 10); // YYYY-MM-DD prefix of ISO timestamp
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
