"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ResponsiveModal } from "@/components/shared/responsive-modal";
import {
  TransferForm,
  type TransferFormWallet,
} from "@/components/transfers/transfer-form";
import { getWalletsWithBalance } from "@/lib/domain/wallets";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";

/**
 * Deep-linkable entry point for "new transfer". Auto-opens the form modal
 * and sends the user back to `/transfers` when it closes. Mirrors the
 * pattern used by `/transactions/new`.
 */
export default function NewTransferPage() {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [wallets, setWallets] = React.useState<TransferFormWallet[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        !process.env.NEXT_PUBLIC_SUPABASE_URL ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ) {
        if (!cancelled) setLoaded(true);
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const items = await getWalletsWithBalance(supabase, user.id);
        if (cancelled) return;
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
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function close() {
    setOpen(false);
    React.startTransition(() => {
      router.push("/transfers");
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else setOpen(true);
      }}
      title={t.transfer.new}
    >
      {!loaded ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t.common.loading}
        </p>
      ) : (
        <TransferForm
          wallets={wallets}
          onSuccess={close}
          onCancel={close}
        />
      )}
    </ResponsiveModal>
  );
}
