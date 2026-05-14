import Link from "next/link";
import { Receipt } from "@phosphor-icons/react/dist/ssr";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export default function TransactionNotFound() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <EmptyState
        icon={Receipt}
        title="Transacción no encontrada"
        description="Puede que la hayas eliminado o que el link esté roto."
        action={
          <Button render={<Link href="/transactions" />}>
            Volver a {t.nav.transactions.toLowerCase()}
          </Button>
        }
      />
    </div>
  );
}
