import { cn } from "@/lib/utils";

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function MobileHeader({ title, subtitle, action, className }: MobileHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 pt-safe md:hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-lg font-semibold leading-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
