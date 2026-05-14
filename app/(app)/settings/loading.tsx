import { Skeleton } from "@/components/ui/skeleton";

/**
 * Settings skeleton — three placeholder cards matching Perfil / Telegram /
 * Apariencia sections.
 */
export default function SettingsLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur pt-safe md:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      <div className="container mx-auto max-w-3xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden md:mb-6 md:block">
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-2xl bg-card ring-1 ring-foreground/10"
            >
              <div className="space-y-2 px-6 pt-6">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-64" />
              </div>
              <div className="px-6 pb-6 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
