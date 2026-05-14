"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, DotsThreeVertical, Pencil, Tag, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import { deleteTransaction } from "@/actions/transactions";
import { QuickCategoryEdit } from "@/components/transactions/quick-category-edit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCategoryIcon } from "@/lib/category-icons";
import type { TransactionWithRefs } from "@/lib/domain/transactions";
import { formatCurrency, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface TransactionRowProps {
  row: TransactionWithRefs;
  className?: string;
}

/**
 * Mobile-first transaction row.
 *
 * Design choice — actions surface:
 *   Implementing a left-swipe reveal robustly across iOS/Android touch +
 *   desktop mouse drag is several hundred lines of pointer-event logic and
 *   would duplicate behaviour vaul already ships. We use a long-press +
 *   3-dot menu instead — both interactions are accessible (the menu has a
 *   visible affordance, the long-press is a power-user shortcut) and
 *   touch targets stay ≥ 64px tall. Documented per the spec.
 */
export function TransactionRow({ row, className }: TransactionRowProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [quickCatOpen, setQuickCatOpen] = React.useState(false);

  // --- long-press to open menu --------------------------------------------
  const longPressTimer = React.useRef<number | null>(null);
  const longPressTriggered = React.useRef(false);

  const cancelLongPress = React.useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const startLongPress = React.useCallback(() => {
    cancelLongPress();
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      setMenuOpen(true);
      if ("vibrate" in navigator) {
        try {
          navigator.vibrate(8);
        } catch {
          // older browsers swallow vibrate() — fine to ignore
        }
      }
    }, 450);
  }, [cancelLongPress]);

  // Suppress the click that follows a long-press so we don't navigate after
  // surfacing the menu.
  const onClickCapture = React.useCallback((e: React.MouseEvent) => {
    if (longPressTriggered.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggered.current = false;
    }
  }, []);

  const handleDelete = React.useCallback(() => {
    startTransition(async () => {
      const result = await deleteTransaction(row.id);
      if (result.ok) {
        toast.success(t.common.deleted);
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [row.id, router]);

  const CategoryIcon = row.category ? getCategoryIcon(row.category.icon) : null;
  const isTransfer = row.type === "transfer";
  const isOutgoing = isTransfer && row.transfer_direction === "out";
  const isIncome = !isTransfer && row.type === "income";

  return (
    <>
      <div
        className={cn(
          "group/tx-row relative flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
          className,
        )}
      >
        <Link
          href={`/transactions/${row.id}`}
          className="flex flex-1 items-center gap-3 outline-none"
          aria-label={`Editar ${row.description ?? row.payee ?? "transacción"}`}
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onClickCapture={onClickCapture}
        >
          {/* Icon: category color for expense/income, neutral gray with
              direction arrow for transfer legs. */}
          {isTransfer ? (
            <span
              aria-hidden
              className="flex size-11 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm"
            >
              {isOutgoing ? (
                <ArrowUp className="size-5" weight="bold" />
              ) : (
                <ArrowDown className="size-5" weight="bold" />
              )}
            </span>
          ) : (
            <span
              aria-hidden
              className="flex size-11 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm"
              style={{
                backgroundColor: row.category?.color ?? "#64748b",
              }}
            >
              {CategoryIcon ? (
                <CategoryIcon className="size-5" weight="fill" />
              ) : (
                <span aria-hidden className="text-xs font-semibold">
                  {isIncome ? "+" : "-"}
                </span>
              )}
            </span>
          )}

          {/* Description / payee. Transfers get a counterpart-aware title;
              everything else keeps the description/payee/category fallback. */}
          <div className="min-w-0 flex-1">
            {isTransfer ? (
              <>
                <p className="truncate text-sm font-medium leading-tight">
                  {row.counterpartWallet
                    ? `${
                        isOutgoing
                          ? t.transaction.transferTo
                          : t.transaction.transferFrom
                      } ${row.counterpartWallet.name}`
                    : t.transaction.transfer}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatDate(row.occurred_at, "HH:mm")}
                  </span>
                </p>
              </>
            ) : (
              <>
                <p className="truncate text-sm font-medium leading-tight">
                  {row.description || row.payee || row.category?.name || "Sin descripción"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatDate(row.occurred_at, "HH:mm")}
                  </span>
                  {row.payee && row.description ? (
                    <>
                      <span aria-hidden> · </span>
                      {row.payee}
                    </>
                  ) : null}
                  {row.category ? (
                    <>
                      <span aria-hidden> · </span>
                      {row.category.name}
                    </>
                  ) : !row.payee && !row.description ? (
                    <>
                      <span aria-hidden> · </span>
                      {row.wallet.name}
                    </>
                  ) : null}
                </p>
              </>
            )}
          </div>

          {/* Amount + wallet badge */}
          <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
            <p
              className={cn(
                "font-heading text-base font-semibold tabular-nums leading-tight",
                isTransfer
                  ? "inline-flex items-center gap-1 text-foreground"
                  : isIncome
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive",
              )}
            >
              {isTransfer ? (
                isOutgoing ? (
                  <ArrowUp aria-hidden className="size-3.5" weight="bold" />
                ) : (
                  <ArrowDown aria-hidden className="size-3.5" weight="bold" />
                )
              ) : (
                <>{isIncome ? "+" : "-"}</>
              )}
              {formatCurrency(Number(row.amount), row.wallet.currency)}
            </p>
            <span
              className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground"
              aria-label={`Wallet ${row.wallet.name}`}
            >
              <span
                aria-hidden
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: row.wallet.color }}
              />
              <span className="truncate max-w-[7rem]">{row.wallet.name}</span>
            </span>
          </div>
        </Link>

        {/* Always-visible 3-dot menu (also long-press target). The menu opens
            controlled so the long-press handler can trigger it programmatically. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Acciones"
                className="rounded-full"
              />
            }
          >
            <DotsThreeVertical weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/transactions/${row.id}`)}
            >
              <Pencil />
              {t.actions.edit}
            </DropdownMenuItem>
            {row.type !== "transfer" ? (
              <DropdownMenuItem onClick={() => setQuickCatOpen(true)}>
                <Tag />
                {t.transaction.editCategory}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash />
              {t.actions.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.common.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la transacción de{" "}
              <strong>
                {formatCurrency(Number(row.amount), row.wallet.currency)}
              </strong>
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t.actions.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending ? "Eliminando…" : t.actions.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {row.type !== "transfer" ? (
        <QuickCategoryEdit
          transactionId={row.id}
          txType={row.type === "income" ? "income" : "expense"}
          currentCategoryId={row.category?.id ?? null}
          open={quickCatOpen}
          onOpenChange={setQuickCatOpen}
        />
      ) : null}
    </>
  );
}
