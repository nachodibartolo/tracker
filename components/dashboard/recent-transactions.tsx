import Link from "next/link";
import { ArrowRight, Receipt } from "@phosphor-icons/react/dist/ssr";

import { TransactionRow } from "@/components/transactions/transaction-row";
import { Card } from "@/components/ui/card";
import type { TransactionWithRefs } from "@/lib/domain/transactions";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface RecentTransactionsProps {
  rows: TransactionWithRefs[];
  className?: string;
}

/**
 * Last 10 transactions surfaced on the dashboard.
 *
 * Reuses the same `<TransactionRow>` as `/transactions` so the swipe / menu
 * affordances stay consistent — but renders without the day-grouping
 * headers because a 10-row strip doesn't benefit from them.
 */
export function RecentTransactions({ rows, className }: RecentTransactionsProps) {
  return (
    <Card size="sm" className={className}>
      <div className="flex flex-col gap-2 px-4 py-4 md:px-5">
        <header className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-base font-medium">
            {t.dashboard.recentTransactions}
          </h2>
          {rows.length > 0 ? (
            <Link
              href="/transactions"
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium text-primary",
                "hover:underline underline-offset-2",
              )}
            >
              {t.dashboard.seeAll}
              <ArrowRight weight="bold" className="size-3.5" />
            </Link>
          ) : null}
        </header>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span
              aria-hidden
              className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <Receipt className="size-6" weight="duotone" />
            </span>
            <p className="text-sm text-muted-foreground">
              Cuando carguemos transacciones, van a aparecer acá.
            </p>
          </div>
        ) : (
          <ul className="-mx-1 flex flex-col">
            {rows.map((row) => (
              <li key={row.id}>
                <TransactionRow row={row} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
