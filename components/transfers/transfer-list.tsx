import { ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr";

import { NewTransferButton } from "@/components/transfers/new-transfer-button";
import { TransferRow } from "@/components/transfers/transfer-row";
import type { TransferDayGroup } from "@/lib/domain/transfers";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TransferListProps {
  groups: TransferDayGroup[];
  className?: string;
  emptyMessage?: string;
  /**
   * When the list is empty we surface a CTA to create the first transfer.
   * Hiding it is useful for places where a separate "New" button is already
   * visible (e.g. embedded inside another module's view).
   */
  showEmptyCta?: boolean;
}

/**
 * Day-grouped transfer list. Mirrors `TransactionList` so the two pages feel
 * consistent — sticky day headers, dashed empty state, optional CTA.
 */
export function TransferList({
  groups,
  className,
  emptyMessage,
  showEmptyCta = true,
}: TransferListProps) {
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
          <ArrowsLeftRight className="size-6" weight="duotone" />
        </span>
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? "Sin transferencias todavía"}
        </p>
        {showEmptyCta ? <NewTransferButton variant="default" size="sm" /> : null}
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
              <TransferRow key={row.id} row={row} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
