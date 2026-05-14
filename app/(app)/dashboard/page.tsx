import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BalanceSummaryCards } from "@/components/dashboard/balance-summary-cards";
import { BalanceTrendChart } from "@/components/dashboard/balance-trend-chart";
import {
  ExpensesByCategoryChart,
  type ExpenseCategorySlice,
} from "@/components/dashboard/expenses-by-category-chart";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { WalletQuickview } from "@/components/dashboard/wallet-quickview";
import { MobileHeader } from "@/components/shared/mobile-header";
import {
  getDashboardData,
  type DashboardData,
} from "@/lib/domain/dashboard";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: t.nav.dashboard,
};

const EMPTY_DASHBOARD: DashboardData = {
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
 * Load dashboard data + main currency.
 *
 * Pre-provisioning safe: when Supabase env vars are missing the layout
 * already skips auth, so we return an all-zero / all-empty payload and let
 * the page render its visual scaffolding without crashes.
 */
async function loadDashboard(): Promise<{
  data: DashboardData;
  mainCurrency: string;
}> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return { data: EMPTY_DASHBOARD, mainCurrency: "ARS" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch the profile in the same hop as dashboard data is fine — the round
  // trip overhead is one extra row, and we need `main_currency` before we
  // can request any FX conversions.
  const { data: profile } = await supabase
    .from("profiles")
    .select("main_currency")
    .eq("id", user.id)
    .maybeSingle();
  const mainCurrency = (profile?.main_currency ?? "ARS").toUpperCase();

  try {
    const data = await getDashboardData(supabase, user.id, mainCurrency);
    return { data, mainCurrency };
  } catch (err) {
    // Defensive: a missing RPC (e.g. running the page before migration 0007
    // was applied) would otherwise crash the route. Log + fall back.
    console.error("[dashboard] load failed", err);
    return { data: EMPTY_DASHBOARD, mainCurrency };
  }
}

export default async function DashboardPage() {
  const { data, mainCurrency } = await loadDashboard();

  const categorySlices: ExpenseCategorySlice[] = data.expensesByCategory.map(
    (entry) => ({
      id: entry.category.id,
      name: entry.category.name,
      color: entry.category.color,
      icon: entry.category.icon,
      totalInMain: entry.totalInMain,
    }),
  );

  return (
    <>
      <MobileHeader title={t.nav.dashboard} />
      <div className="container mx-auto max-w-5xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center justify-between gap-3 md:mb-6 md:flex">
          <div>
            <h1 className="font-heading text-3xl font-semibold">
              {t.nav.dashboard}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu plata de un pantallazo
            </p>
          </div>
        </div>

        <div className="space-y-6 md:space-y-8">
          <BalanceSummaryCards
            totalBalance={data.totalBalance}
            monthExpenses={data.monthExpenses}
            monthIncome={data.monthIncome}
            monthNet={data.monthNet}
            currency={mainCurrency}
          />

          <WalletQuickview
            wallets={data.walletBalances}
            mainCurrency={mainCurrency}
          />

          <ExpensesByCategoryChart
            data={categorySlices}
            currency={mainCurrency}
          />

          <BalanceTrendChart
            data={data.balanceTrend}
            currency={mainCurrency}
          />

          <RecentTransactions rows={data.recentTransactions} />
        </div>
      </div>
    </>
  );
}
