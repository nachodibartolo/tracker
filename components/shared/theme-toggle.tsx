"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const current = theme === "system" ? resolvedTheme : theme;

  return (
    <Button
      type="button"
      variant={variant}
      size="icon"
      className={className}
      aria-label="Cambiar tema"
      onClick={() => setTheme(current === "dark" ? "light" : "dark")}
    >
      <Sun className="h-5 w-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute h-5 w-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  );
}
