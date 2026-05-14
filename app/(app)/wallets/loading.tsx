import { Skeleton } from "@/components/ui/skeleton";

/**
 * Wallets index skeleton — replicates the responsive grid layout used by
 * `<WalletGrid>` so the visual shift on load-in is minimal.
 */
export default function WalletsLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur pt-safe md:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
      <div className="container mx-auto max-w-5xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center justify-between md:mb-6 md:flex">
          <div className="space-y-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    </>
  );
}
