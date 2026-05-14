import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowsLeftRight, CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { EmptyState } from "@/components/shared/empty-state";
import { MobileHeader } from "@/components/shared/mobile-header";
import { NewTransferButton } from "@/components/transfers/new-transfer-button";
import { TransferFilters } from "@/components/transfers/transfer-filters";
import { TransferList } from "@/components/transfers/transfer-list";
import { Button } from "@/components/ui/button";
import {
  groupTransfersByDay,
  listTransfers,
  TRANSFERS_PAGE_SIZE,
  type ListTransfersFilters,
} from "@/lib/domain/transfers";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: t.nav.transfers,
};

interface PageProps {
  // Next 16 turns `searchParams` into a Promise — must be awaited.
  searchParams: Promise<{ [k: string]: string | undefined }>;
}

export default async function TransfersPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Pre-provisioning safe path: render empty state when Supabase isn't
  // configured yet (Wave 0-5 dev). Mirrors wallets/transactions pages.
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

  const filters: ListTransfersFilters = {};
  if (params.fromDate) filters.fromDate = `${params.fromDate}T00:00:00.000Z`;
  if (params.toDate) filters.toDate = `${params.toDate}T23:59:59.999Z`;

  const page = Number.parseInt(params.page ?? "0", 10);
  const safePage = Number.isFinite(page) && page >= 0 ? page : 0;

  const { rows, total } = await listTransfers(supabase, user.id, filters, safePage);
  const groups = groupTransfersByDay(rows);

  const totalPages = Math.max(1, Math.ceil(total / TRANSFERS_PAGE_SIZE));
  const baseQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page" || !v) continue;
    baseQuery.set(k, v);
  }

  return (
    <>
      <MobileHeader
        title={t.nav.transfers}
        action={<NewTransferButton size="sm" iconOnly label={t.transfer.new} />}
      />
      <div className="container mx-auto max-w-3xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center justify-between gap-3 md:mb-6 md:flex">
          <div>
            <h1 className="font-heading text-3xl font-semibold">
              {t.nav.transfers}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total > 0
                ? `${total} transferencia${total === 1 ? "" : "s"} encontrada${total === 1 ? "" : "s"}`
                : "Movés plata entre wallets desde acá"}
            </p>
          </div>
          <NewTransferButton />
        </div>

        <div className="mb-4">
          <TransferFilters />
        </div>

        <TransferList groups={groups} />

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
                    href={`/transfers?${buildPageQuery(baseQuery, safePage - 1)}`}
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
                    href={`/transfers?${buildPageQuery(baseQuery, safePage + 1)}`}
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
      <MobileHeader title={t.nav.transfers} />
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="hidden md:mb-6 md:block">
          <h1 className="font-heading text-3xl font-semibold">
            {t.nav.transfers}
          </h1>
        </div>
        <EmptyState
          icon={ArrowsLeftRight}
          title="Conectá Supabase"
          description="Necesitamos conectar Supabase para listar transferencias."
        />
      </div>
    </>
  );
}
