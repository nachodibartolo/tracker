import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CaretLeft, CaretRight, Receipt } from "@phosphor-icons/react/dist/ssr";

import { EmptyState } from "@/components/shared/empty-state";
import { MobileHeader } from "@/components/shared/mobile-header";
import { NewTransactionTrigger } from "@/components/shared/new-transaction-trigger";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import { getFlatCategoryOptions } from "@/lib/domain/categories";
import {
  groupByDay,
  listTransactions,
  TRANSACTIONS_PAGE_SIZE,
  type ListTransactionsFilters,
} from "@/lib/domain/transactions";
import { getWalletsWithBalance } from "@/lib/domain/wallets";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { TxType } from "@/lib/supabase/database.types";

export const metadata: Metadata = {
  title: t.nav.transactions,
};

interface PageProps {
  // Next 16 turns `searchParams` into a Promise — must be awaited.
  searchParams: Promise<{ [k: string]: string | undefined }>;
}

const ALLOWED_TYPES = new Set<TxType>(["expense", "income", "transfer"]);

export default async function TransactionsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Pre-provisioning safe path: render empty state when Supabase isn't
  // configured yet (Wave 0–5 dev). Mirrors wallets/categories pages.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return <EmptyShell />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Parse filters from URL.
  const filters: ListTransactionsFilters = {};
  if (params.walletId) filters.walletId = params.walletId;
  if (params.categoryId) filters.categoryId = params.categoryId;
  if (params.type && ALLOWED_TYPES.has(params.type as TxType)) {
    filters.type = params.type as TxType;
  }
  if (params.fromDate) filters.fromDate = `${params.fromDate}T00:00:00.000Z`;
  if (params.toDate) filters.toDate = `${params.toDate}T23:59:59.999Z`;
  if (params.q) filters.q = params.q;

  const page = Number.parseInt(params.page ?? "0", 10);
  const safePage = Number.isFinite(page) && page >= 0 ? page : 0;

  const [{ rows, total }, walletsWithBalance, expenseCats, incomeCats] =
    await Promise.all([
      listTransactions(supabase, user.id, filters, safePage),
      getWalletsWithBalance(supabase, user.id, { includeArchived: true }),
      getFlatCategoryOptions(supabase, user.id, "expense"),
      getFlatCategoryOptions(supabase, user.id, "income"),
    ]);

  const wallets = walletsWithBalance.map(({ wallet }) => ({
    id: wallet.id,
    name: wallet.name,
    color: wallet.color,
  }));

  const groups = groupByDay(rows);
  const totalPages = Math.max(1, Math.ceil(total / TRANSACTIONS_PAGE_SIZE));
  const baseQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page" || !v) continue;
    baseQuery.set(k, v);
  }

  return (
    <>
      <MobileHeader title={t.nav.transactions} />
      <div className="container mx-auto max-w-3xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center justify-between gap-3 md:mb-6 md:flex">
          <div>
            <h1 className="font-heading text-3xl font-semibold">
              {t.nav.transactions}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total > 0
                ? `${total} transacciones encontradas`
                : "Cargá tu primer movimiento desde el botón +"}
            </p>
          </div>
          <NewTransactionTrigger />
        </div>

        <div className="mb-4">
          <TransactionFilters
            wallets={wallets}
            categories={{ expense: expenseCats, income: incomeCats }}
          />
        </div>

        <TransactionList groups={groups} />

        {totalPages > 1 ? (
          <nav
            className="mt-6 flex items-center justify-between gap-2"
            aria-label="Paginación"
          >
            {safePage > 0 ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={`/transactions?${buildPageQuery(baseQuery, safePage - 1)}`}
                  />
                }
              >
                <CaretLeft className="size-4" />
                Anterior
              </Button>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted-foreground">
              Página {safePage + 1} de {totalPages}
            </span>
            {safePage + 1 < totalPages ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={`/transactions?${buildPageQuery(baseQuery, safePage + 1)}`}
                  />
                }
              >
                Siguiente
                <CaretRight className="size-4" />
              </Button>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </>
  );
}

function buildPageQuery(base: URLSearchParams, page: number): string {
  const next = new URLSearchParams(base);
  if (page > 0) next.set("page", String(page));
  return next.toString();
}

function EmptyShell() {
  return (
    <>
      <MobileHeader title={t.nav.transactions} />
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="hidden md:mb-6 md:block">
          <h1 className="font-heading text-3xl font-semibold">
            {t.nav.transactions}
          </h1>
        </div>
        <EmptyState
          icon={<Receipt weight="duotone" />}
          title="Conectá Supabase"
          description="Necesitamos conectar Supabase para listar transacciones."
        />
      </div>
    </>
  );
}
