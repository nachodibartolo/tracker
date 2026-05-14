"use client";

import * as React from "react";
import { Plus } from "@phosphor-icons/react";

import { ResponsiveModal } from "@/components/shared/responsive-modal";
import {
  TransferForm,
  type TransferFormWallet,
} from "@/components/transfers/transfer-form";
import { Button } from "@/components/ui/button";
import { getWalletsWithBalance } from "@/lib/domain/wallets";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface NewTransferButtonProps {
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon" | "icon-sm";
  className?: string;
  label?: string;
  iconOnly?: boolean;
}

/**
 * Compact CTA to open the transfer form inside a `<ResponsiveModal>`. Loads
 * wallets lazily on first open via the browser Supabase client — keeps the
 * page initial payload small and matches the wallets-page pattern.
 */
export function NewTransferButton({
  variant = "default",
  size = "default",
  className,
  label,
  iconOnly,
}: NewTransferButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [wallets, setWallets] = React.useState<TransferFormWallet[]>([]);
  const loadedRef = React.useRef(false);
  const [loading, setLoading] = React.useState(false);

  const buttonLabel = label ?? t.transfer.new;

  async function loadData() {
    if (loadedRef.current) return;
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      loadedRef.current = true;
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        loadedRef.current = true;
        return;
      }
      const items = await getWalletsWithBalance(supabase, user.id);
      setWallets(
        items.map(({ wallet, balance }) => ({
          id: wallet.id,
          name: wallet.name,
          currency: wallet.currency,
          color: wallet.color,
          icon: wallet.icon,
          balance,
        })),
      );
      loadedRef.current = true;
    } catch {
      loadedRef.current = true;
    } finally {
      setLoading(false);
    }
  }

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (next && !loadedRef.current) {
      void loadData();
    }
  }, []);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? (size === "sm" ? "icon-sm" : "icon") : size}
        onClick={() => handleOpenChange(true)}
        aria-label={buttonLabel}
        className={cn(iconOnly ? "rounded-full" : undefined, className)}
      >
        <Plus weight="bold" />
        {!iconOnly ? <span>{buttonLabel}</span> : null}
      </Button>

      <ResponsiveModal
        open={open}
        onOpenChange={handleOpenChange}
        title={t.transfer.new}
      >
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t.common.loading}
          </p>
        ) : (
          <TransferForm
            wallets={wallets}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </ResponsiveModal>
    </>
  );
}
