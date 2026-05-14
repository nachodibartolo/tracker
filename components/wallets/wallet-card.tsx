import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { WalletWithBalance } from "@/lib/domain/wallets";
import { cn } from "@/lib/utils";
import { getWalletIcon } from "@/lib/wallet-icons";

interface WalletCardProps {
  item: WalletWithBalance;
  className?: string;
  /**
   * Slot for an action menu in the top-right corner of the card. We accept
   * `ReactNode` (rather than positioning the dropdown ourselves) so callers
   * can decide whether to mount a menu, an edit button, or nothing at all.
   */
  action?: React.ReactNode;
}

export function WalletCard({ item, className, action }: WalletCardProps) {
  const { wallet, balance } = item;
  const Icon = getWalletIcon(wallet.icon);
  const isArchived = wallet.archived;
  const showInitialHint = Number(wallet.initial_balance) !== balance;

  return (
    <Card
      size="sm"
      className={cn(
        "group/wallet-card relative gap-3 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring",
        isArchived && "opacity-60",
        className,
      )}
    >
      <Link
        href={`/wallets/${wallet.id}`}
        className="flex min-h-20 flex-col gap-3 px-4 py-4 outline-none"
        aria-label={`Wallet ${wallet.name}`}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-11 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm"
            style={{ backgroundColor: wallet.color }}
          >
            <Icon className="size-5" weight="fill" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-base font-medium leading-tight">
                {wallet.name}
              </h3>
              {isArchived ? (
                <Badge variant="secondary" className="shrink-0">
                  Archivada
                </Badge>
              ) : null}
              {wallet.excluded_from_stats ? (
                <Badge variant="outline" className="shrink-0">
                  Sin stats
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{t.wallet.types[wallet.type]}</span>
              <span aria-hidden>·</span>
              <span className="font-mono uppercase">{wallet.currency}</span>
            </div>
          </div>
        </div>

        <div className="mt-auto">
          <p
            className={cn(
              "font-heading text-2xl font-semibold tabular-nums",
              balance < 0 ? "text-destructive" : undefined,
            )}
          >
            {formatCurrency(balance, wallet.currency)}
          </p>
          {showInitialHint ? (
            <p className="text-[11px] text-muted-foreground">
              {t.wallet.initialBalance}:{" "}
              {formatCurrency(Number(wallet.initial_balance), wallet.currency)}
            </p>
          ) : null}
        </div>
      </Link>

      {action ? (
        <div
          className="absolute right-2 top-2"
          onClick={(e) => e.stopPropagation()}
        >
          {action}
        </div>
      ) : null}
    </Card>
  );
}
