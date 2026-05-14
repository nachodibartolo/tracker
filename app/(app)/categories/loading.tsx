import { Skeleton } from "@/components/ui/skeleton";

/**
 * Categories skeleton — tabs + a list of tree rows. Mirrors `<CategoryTree>`'s
 * indented rows: 5 top-level placeholders, a couple of indented children.
 */
export default function CategoriesLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur pt-safe md:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 hidden items-center justify-between md:mb-6 md:flex">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-40 rounded-full" />
        </div>

        <Skeleton className="mb-4 h-10 w-full rounded-2xl md:w-64" />

        <div className="space-y-1">
          <Skeleton className="h-14 rounded-2xl" />
          <div className="ml-9 space-y-1 pt-1">
            <Skeleton className="h-12 rounded-2xl" />
            <Skeleton className="h-12 rounded-2xl" />
          </div>
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
          <div className="ml-9 space-y-1 pt-1">
            <Skeleton className="h-12 rounded-2xl" />
          </div>
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
        </div>
      </div>
    </>
  );
}
