import Link from "next/link";
import { Plus, Wallet as WalletIcon } from "@phosphor-icons/react/dist/ssr";

import { WalletActionsMenu } from "@/components/wallets/wallet-actions-menu";
import { WalletCard } from "@/components/wallets/wallet-card";
import { Button } from "@/components/ui/button";
import type { WalletWithBalance } from "@/lib/domain/wallets";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface WalletGridProps {
  wallets: WalletWithBalance[];
  className?: string;
  /**
   * When `false`, suppresses the per-card actions menu (Edit / Archive /
   * Delete). Useful in read-only contexts such as the dashboard.
   * @default true
   */
  withActions?: boolean;
}

export function WalletGrid({
  wallets,
  className,
  withActions = true,
}: WalletGridProps) {
  if (wallets.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/30 px-6 py-12 text-center",
          className,
        )}
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <WalletIcon className="size-6" weight="duotone" />
        </span>
        <p className="text-sm text-muted-foreground">{t.wallet.empty}</p>
        <Button render={<Link href="/wallets/new" />}>
          <Plus weight="bold" />
          {t.wallet.emptyCta}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3",
        className,
      )}
    >
      {wallets.map((item) => (
        <WalletCard
          key={item.wallet.id}
          item={item}
          action={
            withActions ? (
              <WalletActionsMenu wallet={item.wallet} />
            ) : null
          }
        />
      ))}
    </div>
  );
}
