import { getCategoryIcon } from "@/lib/category-icons";
import type { Category } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

interface CategoryBadgeProps {
  category: Pick<Category, "name" | "color" | "icon">;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Inline pill with the category's colored icon + name. Used in tx rows,
 * filters, and the category picker. Color is applied as a translucent tint on
 * the background and a solid stroke on the icon dot, so it reads on light
 * and dark themes.
 */
export function CategoryBadge({
  category,
  size = "md",
  className,
}: CategoryBadgeProps) {
  const Icon = getCategoryIcon(category.icon);
  const sizeCls = size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs";
  const dotCls = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card font-medium leading-none text-foreground",
        sizeCls,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          dotCls,
        )}
        style={{ backgroundColor: `${category.color}20`, color: category.color }}
      >
        <Icon weight="fill" className="h-3 w-3" />
      </span>
      <span className="truncate">{category.name}</span>
    </span>
  );
}
