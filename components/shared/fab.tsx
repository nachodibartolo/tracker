"use client";

import { Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FABProps {
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * Floating Action Button — primary entry point for "New transaction" on mobile.
 * Sits above the bottom nav (`bottom-20` mobile, `bottom-6` desktop).
 * The actual transaction drawer is wired in Wave 3.
 */
export function FAB({ onClick, className, ariaLabel = "Nueva transacción" }: FABProps) {
  return (
    <Button
      type="button"
      size="icon"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "fixed bottom-20 right-4 z-30 h-14 w-14 rounded-full shadow-lg md:bottom-6 md:right-6",
        className,
      )}
    >
      <Plus className="h-6 w-6" weight="bold" />
    </Button>
  );
}
