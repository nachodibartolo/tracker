import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

import { TransactionEditTrigger } from "@/components/transactions/transaction-edit-trigger";
import { MobileHeader } from "@/components/shared/mobile-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getReceiptSignedUrl } from "@/actions/storage";
import { getFlatCategoryOptions } from "@/lib/domain/categories";
import { getTransactionById } from "@/lib/domain/transactions";
import { getWalletsWithBalance } from "@/lib/domain/wallets";
import { formatCurrency, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { Wallet } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: t.nav.transactions,
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TransactionDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    redirect("/transactions");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const row = await getTransactionById(supabase, user.id, id);
  if (!row) notFound();

  // Pre-fetch wallets + categories so the in-place edit modal can mount
  // synchronously without a loading state.
  const [walletItems, expense, income] = await Promise.all([
    getWalletsWithBalance(supabase, user.id, { includeArchived: true }),
    getFlatCategoryOptions(supabase, user.id, "expense"),
    getFlatCategoryOptions(supabase, user.id, "income"),
  ]);

  const wallets: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">[] =
    walletItems.map(({ wallet }) => ({
      id: wallet.id,
      name: wallet.name,
      currency: wallet.currency,
      color: wallet.color,
      icon: wallet.icon,
    }));

  let signedUrl: string | null = null;
  if (row.photo_path) {
    const result = await getReceiptSignedUrl(row.photo_path);
    if (result.ok && result.data) signedUrl = result.data.url;
  }

  const isIncome = row.type === "income";

  return (
    <>
      <MobileHeader
        title={row.description ?? row.payee ?? t.transaction.edit}
        subtitle={formatDate(row.occurred_at, "d 'de' MMMM, HH:mm")}
        action={
          <TransactionEditTrigger
            transaction={row}
            wallets={wallets}
            categoryOptions={{ expense, income }}
          />
        }
      />

      <div className="container mx-auto max-w-2xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center justify-between gap-2 md:flex">
          <Button variant="ghost" size="sm" render={<Link href="/transactions" />}>
            <ArrowLeft />
            {t.actions.back}
          </Button>
          <TransactionEditTrigger
            transaction={row}
            wallets={wallets}
            categoryOptions={{ expense, income }}
          />
        </div>

        <Card className="overflow-hidden">
          <div className="px-6 pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {isIncome ? t.transaction.income : t.transaction.expense}
            </p>
            <p
              className={cn(
                "mt-1 font-heading text-4xl font-semibold tabular-nums",
                isIncome
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive",
              )}
            >
              {isIncome ? "+" : "-"}
              {formatCurrency(Number(row.amount), row.wallet.currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDate(row.occurred_at, "EEEE, d 'de' MMMM 'a las' HH:mm")}
            </p>
          </div>

          <div className="space-y-3 px-6 pb-6 pt-2 text-sm">
            <DetailRow label={t.transaction.wallet}>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: row.wallet.color }}
                />
                <span>{row.wallet.name}</span>
                <Badge variant="outline" className="font-mono uppercase">
                  {row.wallet.currency}
                </Badge>
              </span>
            </DetailRow>

            {row.category ? (
              <DetailRow label={t.transaction.category}>
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: row.category.color }}
                  />
                  <span>{row.category.name}</span>
                </span>
              </DetailRow>
            ) : null}

            {row.description ? (
              <DetailRow label={t.transaction.description}>
                {row.description}
              </DetailRow>
            ) : null}

            {row.payee ? (
              <DetailRow label={t.transaction.payee}>{row.payee}</DetailRow>
            ) : null}

            {row.note ? (
              <DetailRow label={t.transaction.note}>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {row.note}
                </p>
              </DetailRow>
            ) : null}
          </div>
        </Card>

        {signedUrl ? (
          <Card className="mt-4 overflow-hidden">
            <p className="px-6 pt-4 text-xs uppercase tracking-wide text-muted-foreground">
              {t.transaction.photo}
            </p>
            <div className="px-6 pb-6 pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signedUrl}
                alt="Foto del recibo"
                className="w-full rounded-xl border border-border object-contain"
              />
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-border/50 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:gap-4">
      <span className="text-xs uppercase tracking-wide text-muted-foreground sm:w-32 sm:shrink-0 sm:pt-0.5">
        {label}
      </span>
      <span className="flex-1 text-sm">{children}</span>
    </div>
  );
}
