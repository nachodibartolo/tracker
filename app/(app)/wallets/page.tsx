import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MobileHeader } from "@/components/shared/mobile-header";
import { NewWalletButton } from "@/components/wallets/new-wallet-button";
import { WalletGrid } from "@/components/wallets/wallet-grid";
import { getWalletsWithBalance, type WalletWithBalance } from "@/lib/domain/wallets";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: t.nav.wallets,
};

async function loadWallets(): Promise<WalletWithBalance[]> {
  // Pre-provisioning safe path: render the empty state instead of crashing
  // when Supabase isn't configured yet (Wave 0..5 dev).
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return [];
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  return getWalletsWithBalance(supabase, user.id);
}

export default async function WalletsPage() {
  const wallets = await loadWallets();

  return (
    <>
      <MobileHeader
        title={t.nav.wallets}
        action={<NewWalletButton size="sm" iconOnly label={t.wallet.new} />}
      />
      <div className="container mx-auto max-w-5xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden items-center justify-between gap-3 md:mb-6 md:flex">
          <div>
            <h1 className="font-heading text-3xl font-semibold">
              {t.nav.wallets}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tus cuentas, billeteras y tarjetas
            </p>
          </div>
          <NewWalletButton />
        </div>
        <WalletGrid wallets={wallets} />
      </div>
    </>
  );
}
