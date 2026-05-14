"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DotsThree } from "@phosphor-icons/react";

import { ThemeToggle } from "@/components/shared/theme-toggle";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { bottomNavItems, moreNavItems } from "@/components/shared/nav-items";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  userEmail?: string | null;
}

export function BottomNav({ userEmail }: BottomNavProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 pb-safe md:hidden">
      <ul className="grid grid-cols-5 items-stretch">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="contents">
              <Link
                href={item.href}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-5 w-5" weight={isActive ? "fill" : "regular"} />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="contents">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger
              render={
                <button
                  type="button"
                  className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                />
              }
            >
              <DotsThree className="h-5 w-5" weight="bold" />
              <span>Más</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="pb-safe">
              <SheetHeader className="text-left">
                <SheetTitle>Más opciones</SheetTitle>
                <SheetDescription>
                  Navegación y ajustes
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-1 px-4 pb-4">
                {moreNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  );
                })}
                <div className="my-2 h-px bg-border" />
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {userEmail ? (
                      <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                    ) : null}
                  </div>
                  <ThemeToggle />
                  <SignOutButton showLabel={false} />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
