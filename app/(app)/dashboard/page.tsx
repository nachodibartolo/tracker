import type { Metadata } from "next";

import { MobileHeader } from "@/components/shared/mobile-header";
import { t } from "@/lib/i18n";

export const metadata: Metadata = {
  title: t.nav.dashboard,
};

export default function DashboardPage() {
  return (
    <>
      <MobileHeader title={t.nav.dashboard} />
      <div className="container mx-auto max-w-5xl px-4 py-6">
        <div className="hidden md:mb-6 md:block">
          <h1 className="font-heading text-3xl font-semibold">{t.nav.dashboard}</h1>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t.common.welcome}. El dashboard se llenará cuando armemos wallets y transacciones.
          </p>
        </div>
      </div>
    </>
  );
}
