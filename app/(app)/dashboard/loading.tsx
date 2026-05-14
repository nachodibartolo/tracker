import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard skeleton mirroring the real page: 4 summary cards (hero + 3
 * stats), a wallet quickview row, two chart placeholders, and a recent-tx
 * list.
 */
export default function DashboardLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur pt-safe md:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
      <div className="container mx-auto max-w-5xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden md:mb-6 md:block">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>

        <div className="space-y-6 md:space-y-8">
          {/* Summary cards */}
          <div
            className="grid grid-cols-1 gap-3 md:grid-cols-4 md:gap-4"
            aria-hidden
          >
            <Skeleton className="col-span-full h-32 rounded-2xl md:col-span-1 md:row-span-2 md:h-full" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>

          {/* Wallets quickview */}
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </div>
          </div>

          {/* Charts */}
          <div className="space-y-3">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>

          {/* Recent transactions */}
          <div className="space-y-2">
            <Skeleton className="h-5 w-44" />
            <div className="space-y-1">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
