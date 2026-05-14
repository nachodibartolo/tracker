import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { MobileHeader } from "@/components/shared/mobile-header";
import { WalletActionsMenu } from "@/components/wallets/wallet-actions-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listTransactions } from "@/lib/domain/transactions";
import { getWalletById } from "@/lib/domain/wallets";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getWalletIcon } from "@/lib/wallet-icons";

const RECENT_TX_LIMIT = 10;

export const metadata: Metadata = {
  title: t.nav.wallets,
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WalletDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    // Without Supabase configured we can't load a wallet by id — kick back
    // to the list so the user isn't stuck.
    redirect("/wallets");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch wallet metadata and recent transactions in parallel — both queries
  // are RLS-scoped to `user.id`, so the transactions query is wasted only on
  // the rare 404 path (wallet missing or belongs to another user).
  const [item, recentResult] = await Promise.all([
    getWalletById(supabase, id, user.id),
    listTransactions(supabase, user.id, { walletId: id }, 0),
  ]);
  if (!item) notFound();

  const { wallet, balance } = item;
  const Icon = getWalletIcon(wallet.icon);
  const showInitialHint = Number(wallet.initial_balance) !== balance;
  const recentTransactions = recentResult.rows.slice(0, RECENT_TX_LIMIT);

  return (
    <>
      <MobileHeader
        title={wallet.name}
        subtitle={t.wallet.types[wallet.type]}
        action={<WalletActionsMenu wallet={wallet} />}
      />

      <div className="container mx-auto max-w-3xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center gap-2 md:flex">
          <Button
            variant="ghost"
            size="sm"
            render={<Link href="/wallets" />}
          >
            <ArrowLeft />
            {t.actions.back}
          </Button>
        </div>

        <Card className="overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-6 pt-6">
            <div className="flex min-w-0 items-center gap-4">
              <span
                aria-hidden
                className="flex size-14 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm"
                style={{ backgroundColor: wallet.color }}
              >
                <Icon className="size-7" weight="fill" />
              </span>
              <div className="min-w-0">
                <h1 className="font-heading text-2xl font-semibold leading-tight">
                  {wallet.name}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{t.wallet.types[wallet.type]}</Badge>
                  <span className="font-mono uppercase">{wallet.currency}</span>
                  {wallet.archived ? (
                    <Badge variant="secondary">Archivada</Badge>
                  ) : null}
                  {wallet.excluded_from_stats ? (
                    <Badge variant="outline">Sin stats</Badge>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="md:hidden" />
            <div className="hidden md:block">
              <WalletActionsMenu wallet={wallet} />
            </div>
          </div>

          <div className="px-6 pb-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t.dashboard.totalBalance}
            </p>
            <p
              className={cn(
                "mt-1 font-heading text-4xl font-semibold tabular-nums",
                balance < 0 ? "text-destructive" : undefined,
              )}
            >
              {formatCurrency(balance, wallet.currency)}
            </p>
            {showInitialHint ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t.wallet.initialBalance}:{" "}
                {formatCurrency(
                  Number(wallet.initial_balance),
                  wallet.currency,
                )}
              </p>
            ) : null}
          </div>
        </Card>

        <RecentTransactions
          className="mt-6"
          rows={recentTransactions}
          seeAllHref={`/transactions?walletId=${wallet.id}`}
        />
      </div>
    </>
  );
}
