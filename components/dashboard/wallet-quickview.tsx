import Link from "next/link";
import { Plus, Wallet as WalletIcon } from "@phosphor-icons/react/dist/ssr";

import { Card } from "@/components/ui/card";
import type { WalletBalanceInMain } from "@/lib/domain/dashboard";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getWalletIcon } from "@/lib/wallet-icons";

interface WalletQuickviewProps {
  wallets: WalletBalanceInMain[];
  /** Main currency, used as fallback display for cross-currency hint. */
  mainCurrency: string;
  className?: string;
}

/**
 * Dashboard wallets carousel / grid.
 *
 * Mobile: horizontal scrollable strip. `snap-x snap-mandatory` makes the
 * cards lock into place as the user flicks; each card uses `snap-start` and
 * a fixed width so the layout doesn't reflow as more wallets are added.
 *
 * Desktop: 3-column grid (or fewer if the user owns fewer wallets).
 *
 * Cards link to `/wallets/[id]` — the full wallet detail page.
 */
export function WalletQuickview({
  wallets,
  mainCurrency,
  className,
}: WalletQuickviewProps) {
  return (
    <section
      aria-label={t.dashboard.wallets}
      className={cn("flex flex-col gap-2", className)}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="font-heading text-base font-medium">
          {t.dashboard.wallets}
        </h2>
        <Link
          href="/wallets"
          className="text-xs font-medium text-primary hover:underline underline-offset-2"
        >
          {t.dashboard.seeAll}
        </Link>
      </header>

      {wallets.length === 0 ? (
        <Card size="sm">
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <span
              aria-hidden
              className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <WalletIcon className="size-6" weight="duotone" />
            </span>
            <p className="text-sm text-muted-foreground">{t.wallet.empty}</p>
            <Link
              href="/wallets/new"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/85"
            >
              <Plus weight="bold" className="size-3.5" />
              {t.wallet.emptyCta}
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* Mobile carousel */}
          <div className="md:hidden -mx-4 px-4">
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {wallets.map((item) => (
                <WalletMiniCard
                  key={item.wallet.id}
                  item={item}
                  mainCurrency={mainCurrency}
                  className="w-[78vw] max-w-[300px] flex-shrink-0 snap-start"
                />
              ))}
            </div>
          </div>

          {/* Desktop grid */}
          <div className="hidden md:grid md:grid-cols-3 md:gap-3">
            {wallets.map((item) => (
              <WalletMiniCard
                key={item.wallet.id}
                item={item}
                mainCurrency={mainCurrency}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function WalletMiniCard({
  item,
  mainCurrency,
  className,
}: {
  item: WalletBalanceInMain;
  mainCurrency: string;
  className?: string;
}) {
  const { wallet, balance, balanceInMain } = item;
  const Icon = getWalletIcon(wallet.icon);
  const isCrossCurrency = wallet.currency.toUpperCase() !== mainCurrency.toUpperCase();

  return (
    <Card size="sm" className={cn("relative overflow-hidden", className)}>
      <Link
        href={`/wallets/${wallet.id}`}
        className="flex min-h-[112px] flex-col gap-3 px-4 py-3 outline-none"
        aria-label={`Wallet ${wallet.name}`}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-9 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm"
            style={{ backgroundColor: wallet.color }}
          >
            <Icon className="size-4" weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">
              {wallet.name}
            </p>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {wallet.currency}
            </p>
          </div>
        </div>

        <div className="mt-auto">
          <p
            className={cn(
              "font-heading text-xl font-semibold tabular-nums leading-none",
              balance < 0 && "text-destructive",
            )}
          >
            {formatCurrency(balance, wallet.currency)}
          </p>
          {isCrossCurrency ? (
            <p className="mt-1 text-[10px] text-muted-foreground">
              ≈ {formatCurrency(balanceInMain, mainCurrency)}
            </p>
          ) : null}
        </div>
      </Link>
    </Card>
  );
}
