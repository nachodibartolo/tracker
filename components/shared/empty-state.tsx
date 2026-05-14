"use client";

import type { Icon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Phosphor icon component (typed via the main icon type). */
  icon?: Icon;
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
  icon: IconCmp,
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
      {IconCmp ? (
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <IconCmp className="size-6" weight="duotone" />
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
