import { Skeleton } from "@/components/ui/skeleton";

/**
 * Transactions skeleton — replicates the day-grouped list (sticky day header
 * + a few rows per day) used by `<TransactionList>`.
 */
export default function TransactionsLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur pt-safe md:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Skeleton className="h-5 w-36" />
        </div>
      </div>
      <div className="container mx-auto max-w-3xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center justify-between md:mb-6 md:flex">
          <div className="space-y-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-44 rounded-full" />
        </div>

        <Skeleton className="mb-4 h-12 w-full rounded-2xl" />

        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, dayIdx) => (
            <section key={dayIdx} className="space-y-1">
              <Skeleton className="h-4 w-40" />
              <div className="space-y-0.5">
                {Array.from({ length: 4 }).map((_, rowIdx) => (
                  <Skeleton key={rowIdx} className="h-14 rounded-xl" />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
