"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowsLeftRight,
  CalendarBlank,
  Command as CommandIcon,
  Folders,
  PlusCircle,
  Wallet,
} from "@phosphor-icons/react";

import { navItems } from "@/components/shared/nav-items";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * Global Cmd/Ctrl+K command palette. Mounted once inside the `(app)` layout
 * so the shortcut works on every authenticated page.
 *
 * Desktop:  shadcn `<CommandDialog>` (centered, top-third placement).
 * Mobile:   `<Drawer>` from below — gives more vertical room and respects the
 *           bottom nav with a tap-target friendly list.
 *
 * Items use `<Link>` to leverage Next.js prefetching where possible; the
 * onSelect handler closes the palette and falls back to `router.push` so
 * deep links work even when an item is keyboard-activated without focusing
 * the underlying anchor.
 */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const isDesktop = useIsDesktop();

  // Global cmd/ctrl+K listener. We attach once on mount — repeated key events
  // toggle the palette and let the user dismiss with Escape (handled by the
  // dialog/drawer primitives themselves).
  React.useEffect(() => {
    function handler(event: KeyboardEvent) {
      const isToggle =
        event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!isToggle) return;
      // Don't trigger while the user is typing inside an editable field
      // (input/textarea/contenteditable). The palette itself isn't open in
      // that case, so we'd be stealing a Ctrl+K shortcut from form inputs.
      // Exception: if the palette is already open, let the toggle through
      // so users can close it from the search field too.
      if (!open) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        const editable =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          (target?.isContentEditable ?? false);
        if (editable) return;
      }
      event.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);

  const navigate = React.useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const monthExpensesHref = React.useMemo(() => {
    // First-of-month in the user's local clock, formatted YYYY-MM-DD so the
    // server-side filter parser (es-AR) treats it as a plain ISO date.
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const fromDate = `${year}-${month}-01`;
    return `/transactions?type=expense&fromDate=${fromDate}`;
  }, []);

  const body = (
    <CommandPaletteBody
      onNavigate={navigate}
      monthExpensesHref={monthExpensesHref}
    />
  );

  return (
    <>
      {isDesktop ? (
        <CommandDialog open={open} onOpenChange={setOpen} title="Acciones">
          {body}
        </CommandDialog>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader className="sr-only">
              <DrawerTitle>Acciones</DrawerTitle>
              <DrawerDescription>
                Buscá pantallas o accesos rápidos.
              </DrawerDescription>
            </DrawerHeader>
            <div className="pb-2">{body}</div>
          </DrawerContent>
        </Drawer>
      )}

      {/* Optional trigger pill — hidden on mobile, hidden on small viewports. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Abrir paleta de comandos"
        className={cn(
          "pointer-events-auto fixed bottom-6 right-24 z-30 hidden h-8 items-center gap-1.5 px-3 text-xs text-muted-foreground md:inline-flex",
        )}
      >
        <CommandIcon className="size-3.5" weight="bold" />
        <span>K</span>
      </Button>
    </>
  );
}

interface CommandPaletteBodyProps {
  onNavigate: (href: string) => void;
  monthExpensesHref: string;
}

function CommandPaletteBody({
  onNavigate,
  monthExpensesHref,
}: CommandPaletteBodyProps) {
  return (
    <Command>
      <CommandInput placeholder="Buscar acciones, páginas, filtros…" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>

        <CommandGroup heading="Crear">
          <CommandItem
            value="nueva transaccion gasto ingreso"
            onSelect={() => onNavigate("/transactions/new")}
          >
            <PlusCircle weight="duotone" />
            <span>Nueva transacción</span>
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nueva wallet billetera cuenta"
            onSelect={() => onNavigate("/wallets/new")}
          >
            <Wallet weight="duotone" />
            <span>Nueva wallet</span>
          </CommandItem>
          <CommandItem
            value="nueva categoria gasto"
            onSelect={() => onNavigate("/categories?new=expense")}
          >
            <Folders weight="duotone" />
            <span>Nueva categoría</span>
          </CommandItem>
          <CommandItem
            value="nueva transferencia entre wallets"
            onSelect={() => onNavigate("/transfers/new")}
          >
            <ArrowsLeftRight weight="duotone" />
            <span>Nueva transferencia</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Ir a">
          {navItems.map((item) => {
            const ItemIcon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={`${item.label} ${item.href}`}
                onSelect={() => onNavigate(item.href)}
              >
                <ItemIcon weight="duotone" />
                {/* Use a Link so Next can prefetch the route on hover/focus. */}
                <Link
                  href={item.href}
                  onClick={(event) => event.preventDefault()}
                  className="flex-1"
                >
                  {item.label}
                </Link>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Filtros rápidos">
          <CommandItem
            value="gastos del mes filtro"
            onSelect={() => onNavigate(monthExpensesHref)}
          >
            <CalendarBlank weight="duotone" />
            <span>Ver gastos del mes</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
