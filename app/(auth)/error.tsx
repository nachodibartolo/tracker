"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowClockwise, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * Error boundary scoped to the `(auth)` segment. Auth pages have a slimmer
 * shell so the fallback CTA is "go to login" rather than "go to dashboard".
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[auth] route error", error);
    toast.error(error.message || t.common.error);
  }, [error]);

  return (
    <EmptyState
      icon={<Warning weight="duotone" />}
      title={t.common.error}
      description={
        error.message ||
        "No pudimos cargar este paso. Probá de nuevo o volvé al login."
      }
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => reset()}>
            <ArrowClockwise weight="bold" />
            Reintentar
          </Button>
          <Button variant="outline" render={<Link href="/login" />}>
            {t.actions.login}
          </Button>
        </div>
      }
    />
  );
}
