import Link from "next/link";
import { Wallet } from "@phosphor-icons/react/dist/ssr";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export default function WalletNotFound() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <EmptyState
        icon={<Wallet weight="duotone" />}
        title="Wallet no encontrada"
        description="Puede que la hayas eliminado o que el link esté roto."
        action={
          <Button render={<Link href="/wallets" />}>
            Volver a {t.nav.wallets.toLowerCase()}
          </Button>
        }
      />
    </div>
  );
}
