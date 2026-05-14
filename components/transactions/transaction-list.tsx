import { Receipt } from "@phosphor-icons/react/dist/ssr";

import { TransactionRow } from "@/components/transactions/transaction-row";
import type { TransactionDayGroup } from "@/lib/domain/transactions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TransactionListProps {
  groups: TransactionDayGroup[];
  className?: string;
  /** Override the empty-state copy. */
  emptyMessage?: string;
}

/**
 * Day-grouped transaction list. Each group's `<h3>` is sticky so the day
 * stays visible while the user scrolls a long day. Top offset accounts for
 * the mobile header (h-14 → 3.5rem) and the desktop sidebar gutter.
 */
export function TransactionList({
  groups,
  className,
  emptyMessage,
}: TransactionListProps) {
  if (groups.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/30 px-6 py-12 text-center",
          className,
        )}
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Receipt className="size-6" weight="duotone" />
        </span>
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? "Sin transacciones todavía"}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {groups.map((group) => (
        <section key={group.day} aria-label={group.day} className="space-y-1">
          <h3 className="sticky top-14 z-10 -mx-1 px-1 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/75 md:top-0">
            {formatDate(`${group.day}T00:00:00Z`, "EEEE, d 'de' MMMM")}
          </h3>
          <div className="space-y-0.5">
            {group.rows.map((row) => (
              <TransactionRow key={row.id} row={row} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
