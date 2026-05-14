"use client";

import * as React from "react";
import { Plus } from "@phosphor-icons/react";

import { ResponsiveModal } from "@/components/shared/responsive-modal";
import { Button } from "@/components/ui/button";
import { WalletForm } from "@/components/wallets/wallet-form";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface NewWalletButtonProps {
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon" | "icon-sm";
  className?: string;
  /** Label override; defaults to `t.wallet.new` (icon button hides label). */
  label?: string;
  /** Render as icon-only (just a `+`). */
  iconOnly?: boolean;
}

/**
 * Compact client-side trigger that opens the wallet form inside a
 * `<ResponsiveModal>`. Used by the wallets page header and any other CTA
 * that needs to spawn the create flow without changing the URL.
 *
 * The dedicated route `/wallets/new` exists for deep-linking and for the
 * sidebar/FAB; that route renders a separate auto-opening modal wrapper.
 */
export function NewWalletButton({
  variant = "default",
  size = "default",
  className,
  label,
  iconOnly,
}: NewWalletButtonProps) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const buttonLabel = label ?? t.wallet.new;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? (size === "sm" ? "icon-sm" : "icon") : size}
        onClick={() => setOpen(true)}
        aria-label={buttonLabel}
        className={cn(iconOnly ? "rounded-full" : undefined, className)}
      >
        <Plus weight="bold" />
        {!iconOnly ? <span>{buttonLabel}</span> : null}
      </Button>

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title={t.wallet.new}
        description="Configurá los datos básicos. Podés editarlos después."
      >
        <WalletForm mode="create" onSuccess={close} onCancel={close} />
      </ResponsiveModal>
    </>
  );
}
