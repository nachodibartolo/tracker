"use client";

import { useTransition } from "react";
import { SignOut } from "@phosphor-icons/react";

import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  className,
  variant = "ghost",
  size = "sm",
  showLabel = true,
}: {
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  showLabel?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      size={showLabel ? size : "icon"}
      className={className}
      aria-label="Cerrar sesión"
      disabled={pending}
      onClick={() => startTransition(() => signOut())}
    >
      <SignOut className="h-4 w-4" />
      {showLabel ? <span>{pending ? "Saliendo…" : "Salir"}</span> : null}
    </Button>
  );
}
