"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ResponsiveModal } from "@/components/shared/responsive-modal";
import { WalletForm } from "@/components/wallets/wallet-form";
import { t } from "@/lib/i18n";

/**
 * Deep-linkable entry point for "new wallet". Renders an auto-opening
 * `<ResponsiveModal>` on top of the wallets list; closing or completing the
 * form sends the user back to `/wallets`.
 *
 * Kept as a client page because the modal has to mount immediately and the
 * close behaviour depends on the router. The wallets list under it is still
 * server-rendered (it lives at the parent route).
 */
export default function NewWalletPage() {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);

  function close() {
    setOpen(false);
    // Defer the navigation slightly so the dismiss animation can run.
    React.startTransition(() => {
      router.push("/wallets");
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else setOpen(true);
      }}
      title={t.wallet.new}
      description="Configurá los datos básicos. Podés editarlos después."
    >
      <WalletForm
        mode="create"
        onSuccess={() => close()}
        onCancel={() => close()}
      />
    </ResponsiveModal>
  );
}
