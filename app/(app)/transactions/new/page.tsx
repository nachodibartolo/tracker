"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ResponsiveModal } from "@/components/shared/responsive-modal";
import {
  TransactionForm,
  type CategoryOptionsByType,
} from "@/components/transactions/transaction-form";
import { createClient } from "@/lib/supabase/client";
import {
  getFlatCategoryOptions,
  type FlatCategoryOption,
} from "@/lib/domain/categories";
import { getWalletsWithBalance } from "@/lib/domain/wallets";
import { t } from "@/lib/i18n";
import type { Wallet } from "@/lib/supabase/database.types";

type FormWallet = Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">;

/**
 * Deep-linkable entry point for "new transaction". Auto-opens the form modal
 * and sends the user back to `/transactions` when it closes. Mirrors the
 * pattern used by `/wallets/new`.
 */
export default function NewTransactionPage() {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [wallets, setWallets] = React.useState<FormWallet[]>([]);
  const [categories, setCategories] = React.useState<CategoryOptionsByType>({
    expense: [],
    income: [],
  });

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
        const [walletItems, expense, income] = await Promise.all([
          getWalletsWithBalance(supabase, user.id),
          getFlatCategoryOptions(supabase, user.id, "expense") as Promise<FlatCategoryOption[]>,
          getFlatCategoryOptions(supabase, user.id, "income") as Promise<FlatCategoryOption[]>,
        ]);
        if (cancelled) return;
        setWallets(
          walletItems.map(({ wallet }) => ({
            id: wallet.id,
            name: wallet.name,
            currency: wallet.currency,
            color: wallet.color,
            icon: wallet.icon,
          })),
        );
        setCategories({ expense, income });
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
      router.push("/transactions");
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else setOpen(true);
      }}
      title={t.transaction.new}
    >
      {!loaded ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t.common.loading}
        </p>
      ) : (
        <TransactionForm
          mode="create"
          wallets={wallets}
          categoryOptions={categories}
          onSuccess={close}
          onCancel={close}
        />
      )}
    </ResponsiveModal>
  );
}
