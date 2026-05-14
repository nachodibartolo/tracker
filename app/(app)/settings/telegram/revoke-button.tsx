"use client";

// Small wrapper around the `revokeTelegramLink` server action so we can call
// it from both the settings overview page and the telegram detail page. Lives
// alongside the page that owns the deeper UX.

import { useTransition } from "react";

import { revokeTelegramLink } from "@/actions/telegram";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export function RevokeTelegramButton({
  className,
}: {
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      className={className}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await revokeTelegramLink();
          if (!res.ok) {
            // Surface server error without pulling in the full toast stack
            // for this single button.
            console.error("[telegram/revoke]", res.error);
          }
        })
      }
    >
      {pending ? "Desvinculando…" : t.settings.telegramDisconnect}
    </Button>
  );
}
