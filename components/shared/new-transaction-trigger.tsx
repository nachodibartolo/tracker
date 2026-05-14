"use client";

import * as React from "react";

import { FAB } from "@/components/shared/fab";
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
 * Global "New transaction" FAB. Opens a `<ResponsiveModal>` (Drawer on
 * mobile / Dialog on desktop) with the transaction form pre-loaded.
 *
 * Data (wallets + categories) is fetched lazily on first open via the public
 * browser Supabase client — that avoids paying the cost on every page render
 * and keeps the FAB pre-provisioning-safe (no env vars → empty state inside
 * the modal explaining you need a wallet first).
 *
 * Once fetched the result is cached for the component's lifetime; opening
 * the modal again does not re-fetch.
 */
export function NewTransactionTrigger() {
  const [open, setOpen] = React.useState(false);
  const [wallets, setWallets] = React.useState<FormWallet[]>([]);
  const [categories, setCategories] = React.useState<CategoryOptionsByType>({
    expense: [],
    income: [],
  });
  const loadedRef = React.useRef(false);
  const [loading, setLoading] = React.useState(false);

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (next && !loadedRef.current) {
      void loadData();
    }
  }, []);

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
      const [walletItems, expense, income] = await Promise.all([
        getWalletsWithBalance(supabase, user.id),
        getFlatCategoryOptions(supabase, user.id, "expense") as Promise<FlatCategoryOption[]>,
        getFlatCategoryOptions(supabase, user.id, "income") as Promise<FlatCategoryOption[]>,
      ]);
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
      loadedRef.current = true;
    } catch {
      loadedRef.current = true;
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <FAB onClick={() => handleOpenChange(true)} />
      <ResponsiveModal
        open={open}
        onOpenChange={handleOpenChange}
        title={t.transaction.new}
      >
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t.common.loading}
          </p>
        ) : (
          <TransactionForm
            mode="create"
            wallets={wallets}
            categoryOptions={categories}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </ResponsiveModal>
    </>
  );
}
