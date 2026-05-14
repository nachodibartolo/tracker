import {
  ArrowDown,
  ArrowUp,
  Equals,
  Wallet,
} from "@phosphor-icons/react/dist/ssr";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface BalanceSummaryCardsProps {
  totalBalance: number;
  monthExpenses: number;
  monthIncome: number;
  monthNet: number;
  currency: string;
  className?: string;
}

/**
 * Four summary cards above the dashboard.
 *
 * Layout choice: on mobile we stack vertically (full-width hero on top, 3
 * "stat" cards in a single column below). On desktop we use a 4-col grid
 * where the hero takes the leftmost column and the 3 stats fill the rest.
 *
 * The hero card uses `col-span-full md:col-span-1` so it stretches edge-to-
 * edge on mobile then snaps into the grid above the others on desktop.
 */
export function BalanceSummaryCards({
  totalBalance,
  monthExpenses,
  monthIncome,
  monthNet,
  currency,
  className,
}: BalanceSummaryCardsProps) {
  const netPositive = monthNet >= 0;

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-3 md:grid-cols-4 md:gap-4",
        className,
      )}
      aria-label={t.dashboard.totalBalance}
    >
      <Card
        size="sm"
        className="relative col-span-full overflow-hidden bg-gradient-to-br from-primary/15 via-primary/8 to-transparent md:col-span-1 md:row-span-2"
      >
        <div className="flex h-full min-h-[180px] flex-col justify-between gap-4 px-5 py-5 md:px-6 md:py-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Wallet weight="duotone" className="size-3.5" />
            <span>{t.dashboard.totalBalance}</span>
          </div>
          <p
            className={cn(
              "font-heading text-2xl font-semibold tabular-nums leading-none md:text-3xl",
              totalBalance < 0 && "text-destructive",
            )}
          >
            {formatCurrency(totalBalance, currency)}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            actualizado hoy
          </p>
        </div>
      </Card>

      <StatCard
        label={t.dashboard.monthExpenses}
        value={monthExpenses}
        currency={currency}
        intent="negative"
      />
      <StatCard
        label={t.dashboard.monthIncome}
        value={monthIncome}
        currency={currency}
        intent="positive"
      />
      <StatCard
        label={t.dashboard.monthNet}
        value={monthNet}
        currency={currency}
        intent={netPositive ? "positive" : "neutral"}
      />
    </section>
  );
}

function StatCard({
  label,
  value,
  currency,
  intent,
}: {
  label: string;
  value: number;
  currency: string;
  intent: "positive" | "negative" | "neutral";
}) {
  const Icon =
    intent === "positive" ? ArrowUp : intent === "negative" ? ArrowDown : Equals;
  const iconClass =
    intent === "positive"
      ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
      : intent === "negative"
        ? "text-destructive bg-destructive/10"
        : "text-muted-foreground bg-muted";
  const valueClass =
    intent === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : intent === "negative"
        ? "text-destructive"
        : undefined;

  return (
    <Card size="sm">
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span
            aria-hidden
            className={cn(
              "flex size-7 flex-shrink-0 items-center justify-center rounded-full",
              iconClass,
            )}
          >
            <Icon weight="bold" className="size-3.5" />
          </span>
        </div>
        <p
          className={cn(
            "font-heading text-xl font-semibold tabular-nums leading-none",
            valueClass,
          )}
        >
          {formatCurrency(value, currency)}
        </p>
      </div>
    </Card>
  );
}
