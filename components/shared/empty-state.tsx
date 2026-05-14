"use client";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /**
   * Rendered icon element (e.g. `<Wallet weight="duotone" />`). Accepted as
   * `ReactNode` rather than a component so Server Components can pass
   * Phosphor icons without tripping RSC serialization (forwardRef objects
   * aren't serializable across the Server → Client boundary).
   */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Usually a `<Button>` or `<Link>` styled as a CTA. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Reusable empty-state card. Mirrors the dashed border + centered layout used
 * across wallets/transactions/transfers empty views so the app feels coherent
 * when there's nothing to show.
 *
 * The icon is rendered with `aria-hidden` (the text below carries meaning).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/30 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6"
        >
          {icon}
        </span>
      ) : null}
      <div className="space-y-1">
        <h3 className="font-heading text-lg font-medium">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
