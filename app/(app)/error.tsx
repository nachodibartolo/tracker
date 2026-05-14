"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowClockwise, House, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * Catch-all error boundary for the authenticated `(app)` segment. Receives
 * the standard Next.js `{ error, reset }` signature; logs to console (so the
 * Next overlay still surfaces it in dev) and emits a sonner toast so the
 * user always gets a hint of what happened.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] route error", error);
    toast.error(error.message || t.common.error);
  }, [error]);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <EmptyState
        icon={Warning}
        title={t.common.error}
        description={
          error.message ||
          "Algo se rompió cargando esta página. Probá de nuevo en un toque."
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={() => reset()}>
              <ArrowClockwise weight="bold" />
              Reintentar
            </Button>
            <Button variant="outline" render={<Link href="/dashboard" />}>
              <House weight="bold" />
              Volver al inicio
            </Button>
          </div>
        }
      />
    </div>
  );
}
