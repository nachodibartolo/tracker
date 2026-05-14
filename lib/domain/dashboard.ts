import type { SupabaseClient } from "@supabase/supabase-js";

import { getWalletsWithBalance } from "@/lib/domain/wallets";
import {
  listTransactions,
  type TransactionWithRefs,
} from "@/lib/domain/transactions";
import { convertMany } from "@/lib/fx/convert";
import type {
  Category,
  Database,
  Wallet,
} from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export interface WalletBalanceInMain {
  wallet: Wallet;
  /** Balance in the wallet's own currency. */
  balance: number;
  /** Balance converted to the user's main currency. */
  balanceInMain: number;
}

export interface ExpenseByCategoryEntry {
  category: Category;
  /** Sum of this category's expenses in its first-seen currency. */
  total: number;
  /** Sum converted to the user's main currency. */
  totalInMain: number;
}

export interface BalanceTrendPoint {
  /** YYYY-MM-DD (UTC). */
  day: string;
  /** Running balance in the user's main currency. */
  balance: number;
}

export interface DashboardData {
  totalBalance: number;
  walletBalances: WalletBalanceInMain[];
  monthExpenses: number;
  monthIncome: number;
  monthNet: number;
  expensesByCategory: ExpenseByCategoryEntry[];
  balanceTrend: BalanceTrendPoint[];
  recentTransactions: TransactionWithRefs[];
}

const EMPTY: DashboardData = {
  totalBalance: 0,
  walletBalances: [],
  monthExpenses: 0,
  monthIncome: 0,
  monthNet: 0,
  expensesByCategory: [],
  balanceTrend: [],
  recentTransactions: [],
};

/**
 * Format a Date as `YYYY-MM-DD` in UTC.
 */
function ymdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns `[from, to)` covering the **current calendar month** in UTC.
 *
 * `from` is the first of the month at 00:00:00 UTC, `to` is the first of
 * **next** month — exclusive — so a row at `2026-05-31T23:59:59Z` lands in
 * May and a row at `2026-06-01T00:00:00Z` lands in June.
 */
function currentMonthRangeUtc(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Fetch every datum the dashboard renders in one server-side pass.
 *
 * Strategy:
 *   1. Run the four SQL aggregations + wallets + recent transactions + a
 *      category lookup in parallel.
 *   2. Convert per-currency totals to `mainCurrency` in JS via the FX cache
 *      (`convertMany`) — SQL never sees rates.
 *   3. Stitch the chart series: SQL returned daily deltas only for wallets
 *      already denominated in `mainCurrency`. We add their combined initial
 *      balance and compute cumulative sums day-by-day (filling gaps).
 *
 * Pre-provisioning safe: if Supabase env vars are missing, returns an
 * all-zero, all-empty `EMPTY` shape so callers can render the page without
 * crashing during local dev (Waves 0–5).
 */
export async function getDashboardData(
  supabase: TypedClient,
  userId: string,
  mainCurrency: string,
): Promise<DashboardData> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return EMPTY;
  }

  const target = mainCurrency.trim().toUpperCase();
  const now = new Date();
  const { from: monthFrom, to: monthTo } = currentMonthRangeUtc(now);

  // 30-day trend window — inclusive of today.
  const trendTo = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  const trendFrom = new Date(trendTo.getTime() - 29 * 24 * 60 * 60 * 1000);
  const trendFromYmd = ymdUtc(trendFrom);
  const trendToYmd = ymdUtc(trendTo);

  // Run everything we don't need to chain in parallel. We can't ask the
  // category lookup until we know which ids the chart pulled, but the rest
  // is independent — wallets, recent transactions, both range aggregations,
  // and the daily series are all independent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  const [
    walletsResult,
    recentResult,
    summaryRpc,
    catRpc,
    seriesRpc,
  ] = await Promise.all([
    getWalletsWithBalance(supabase, userId).catch(() => []),
    listTransactions(supabase, userId, {}, 0).catch(() => ({
      rows: [],
      total: 0,
    })),
    sb
      .rpc("monthly_summary", {
        p_user_id: userId,
        p_from: monthFrom,
        p_to: monthTo,
      })
      .then((r: { data: unknown; error: unknown }) => r)
      .catch(() => ({ data: null, error: null })),
    sb
      .rpc("expenses_by_category", {
        p_user_id: userId,
        p_from: monthFrom,
        p_to: monthTo,
      })
      .then((r: { data: unknown; error: unknown }) => r)
      .catch(() => ({ data: null, error: null })),
    sb
      .rpc("daily_balance_series", {
        p_user_id: userId,
        p_currency: target,
        p_from: trendFromYmd,
        p_to: trendToYmd,
      })
      .then((r: { data: unknown; error: unknown }) => r)
      .catch(() => ({ data: null, error: null })),
  ]);

  // ----- 1. Wallet balances → main_currency -------------------------------
  const walletBalances: WalletBalanceInMain[] = walletsResult.length
    ? (
        await convertMany(
          walletsResult.map(({ wallet, balance }) => ({
            walletId: wallet.id,
            wallet,
            balance,
            amount: balance,
            currency: wallet.currency,
          })),
          target,
        ).catch(
          () =>
            walletsResult.map(({ wallet, balance }) => ({
              walletId: wallet.id,
              wallet,
              balance,
              amount: balance,
              currency: wallet.currency,
              // No FX available → fall back to native value so the dashboard
              // still renders something useful.
              converted: balance,
            })) as Array<{
              walletId: string;
              wallet: Wallet;
              balance: number;
              amount: number;
              currency: string;
              converted: number;
            }>,
        )
      ).map((entry) => ({
        wallet: entry.wallet,
        balance: entry.balance,
        balanceInMain: entry.converted,
      }))
    : [];

  const totalBalance = walletBalances.reduce(
    (sum, w) => sum + w.balanceInMain,
    0,
  );

  // ----- 2. Monthly summary (income / expense) ----------------------------
  type MonthlyRow = { income: number; expense: number; currency: string };
  const monthlyRows: MonthlyRow[] = ((summaryRpc as { data: unknown }).data ??
    []) as MonthlyRow[];

  // Build a unified `{ amount, currency }` list. We send income and expense
  // separately so a single FX call covers both.
  const monthlyConverted = monthlyRows.length
    ? await convertMany(
        monthlyRows.flatMap((row) => [
          { kind: "income" as const, amount: Number(row.income), currency: row.currency },
          { kind: "expense" as const, amount: Number(row.expense), currency: row.currency },
        ]),
        target,
      ).catch(() => [])
    : [];

  let monthIncome = 0;
  let monthExpenses = 0;
  for (const entry of monthlyConverted) {
    if (entry.kind === "income") monthIncome += entry.converted;
    else monthExpenses += entry.converted;
  }
  const monthNet = monthIncome - monthExpenses;

  // ----- 3. Expenses by category ------------------------------------------
  type CatRow = { category_id: string | null; total: number; currency: string };
  const catRows: CatRow[] = ((catRpc as { data: unknown }).data ??
    []) as CatRow[];

  // Resolve category metadata for the ids we actually need.
  const catIds = Array.from(
    new Set(
      catRows
        .map((r) => r.category_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const categoriesById = new Map<string, Category>();
  if (catIds.length > 0) {
    const { data: cats } = await supabase
      .from("categories")
      .select("*")
      .in("id", catIds);
    for (const c of (cats ?? []) as Category[]) {
      categoriesById.set(c.id, c);
    }
  }

  // Convert all currency totals in one batch.
  const catConverted = catRows.length
    ? await convertMany(
        catRows.map((row) => ({
          categoryId: row.category_id,
          rawTotal: Number(row.total),
          amount: Number(row.total),
          currency: row.currency,
        })),
        target,
      ).catch(() =>
        catRows.map((row) => ({
          categoryId: row.category_id,
          rawTotal: Number(row.total),
          amount: Number(row.total),
          currency: row.currency,
          converted: Number(row.total),
        })),
      )
    : [];

  // Sum across currencies per category. A single category may have rows in
  // multiple currencies (e.g. "Comida" with both ARS and USD legs).
  const categoryAgg = new Map<
    string,
    { category: Category | null; total: number; totalInMain: number }
  >();
  for (const entry of catConverted) {
    const id = entry.categoryId ?? "__uncategorized__";
    const existing = categoryAgg.get(id);
    if (existing) {
      existing.total += entry.rawTotal;
      existing.totalInMain += entry.converted;
    } else {
      categoryAgg.set(id, {
        category: entry.categoryId
          ? categoriesById.get(entry.categoryId) ?? null
          : null,
        total: entry.rawTotal,
        totalInMain: entry.converted,
      });
    }
  }

  // Fabricate a placeholder Category for the "uncategorized" bucket so the
  // chart legend never renders a null name. The id is non-UUID on purpose so
  // it can't collide with a real row.
  const expensesByCategory: ExpenseByCategoryEntry[] = Array.from(
    categoryAgg.entries(),
  )
    .map(([id, entry]) => ({
      category:
        entry.category ??
        ({
          id,
          user_id: userId,
          name: "Sin categoría",
          type: "expense",
          parent_id: null,
          color: "#64748b",
          icon: "tag",
          position: 0,
          is_system: false,
          created_at: new Date(0).toISOString(),
        } satisfies Category),
      total: entry.total,
      totalInMain: entry.totalInMain,
    }))
    .sort((a, b) => b.totalInMain - a.totalInMain);

  // ----- 4. Balance trend (last 30 days, cumulative) ----------------------
  type DeltaRow = { day: string; delta: number };
  const deltaRows: DeltaRow[] = ((seriesRpc as { data: unknown }).data ??
    []) as DeltaRow[];
  const deltasByDay = new Map<string, number>();
  for (const row of deltaRows) {
    // RPC may return "day" as `Date`-serialized string; normalise to YMD.
    const key = String(row.day).slice(0, 10);
    deltasByDay.set(key, (deltasByDay.get(key) ?? 0) + Number(row.delta));
  }

  // Starting balance for the chart = sum of (initial_balance) for wallets in
  // `target` currency. We deliberately do NOT use today's converted total
  // because we want the chart to show the natural-currency history without
  // mixing FX swings into the curve.
  const startingBalance = walletsResult
    .filter((w) => w.wallet.currency.toUpperCase() === target)
    .reduce((sum, w) => sum + Number(w.wallet.initial_balance), 0);

  // Apply deltas chronologically up to `trendFrom - 1 day` to seed the
  // running total at the chart's left edge. The SQL function only returned
  // rows inside `[trendFrom, trendTo]`, so we additionally need the historic
  // sum before that window. We could query it separately, but in practice
  // an approximation suffices for the 30-day shape: start from
  // `wallet_balance(today) - sum(deltas in window)` and roll forward.
  const inWindowTotal = Array.from(deltasByDay.values()).reduce(
    (s, v) => s + v,
    0,
  );
  const todayBalanceInTarget = walletsResult
    .filter((w) => w.wallet.currency.toUpperCase() === target)
    .reduce((sum, w) => sum + w.balance, 0);
  let running = todayBalanceInTarget - inWindowTotal;
  void startingBalance;

  const balanceTrend: BalanceTrendPoint[] = [];
  for (let i = 0; i < 30; i++) {
    const day = new Date(trendFrom.getTime() + i * 24 * 60 * 60 * 1000);
    const key = ymdUtc(day);
    running += deltasByDay.get(key) ?? 0;
    balanceTrend.push({ day: key, balance: running });
  }

  // ----- 5. Recent transactions ------------------------------------------
  const recentTransactions = recentResult.rows.slice(0, 10);

  return {
    totalBalance,
    walletBalances,
    monthExpenses,
    monthIncome,
    monthNet,
    expensesByCategory,
    balanceTrend,
    recentTransactions,
  };
}
