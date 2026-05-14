"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  DotsThreeVertical,
  Trash,
} from "@phosphor-icons/react";
import { toast } from "sonner";

import { deleteTransfer } from "@/actions/transfers";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TransferRow as TransferRowType } from "@/lib/domain/transfers";
import { formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface TransferRowProps {
  row: TransferRowType;
  className?: string;
}

/**
 * Mobile-first row for the transfers list. Mirrors the transaction row's
 * long-press + 3-dot menu pattern so users learn the gesture once.
 *
 * Layout: arrow icon in the centre, "From → To" wallets on the left with
 * coloured dots, amounts + currencies on the right, date implicit (handled by
 * the day-grouping header).
 *
 * Transfers don't currently support inline edit — power users delete and
 * recreate. The detail page (Wave 4A v2) can add one later if needed.
 */
export function TransferRow({ row, className }: TransferRowProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

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

  const onClickCapture = React.useCallback((e: React.MouseEvent) => {
    if (longPressTriggered.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggered.current = false;
    }
  }, []);

  const handleDelete = React.useCallback(() => {
    startTransition(async () => {
      const result = await deleteTransfer(row.id);
      if (result.ok) {
        toast.success(t.common.deleted);
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [row.id, router]);

  const crossCurrency = row.currencyFrom !== row.currencyTo;

  return (
    <>
      <div
        className={cn(
          "group/transfer-row relative flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
          className,
        )}
      >
        <div
          className="flex flex-1 items-center gap-3 outline-none"
          role="group"
          aria-label={`Transferencia de ${row.fromWallet.name} a ${row.toWallet.name}`}
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onClickCapture={onClickCapture}
        >
          {/* Arrow icon */}
          <span
            aria-hidden
            className="flex size-11 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm"
          >
            <ArrowRight className="size-5" weight="bold" />
          </span>

          {/* From → To */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: row.fromWallet.color }}
              />
              <span className="truncate">{row.fromWallet.name}</span>
              <ArrowRight
                aria-hidden
                className="size-3 shrink-0 text-muted-foreground"
                weight="bold"
              />
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: row.toWallet.color }}
              />
              <span className="truncate">{row.toWallet.name}</span>
            </div>
            {row.note ? (
              <p className="truncate text-xs text-muted-foreground">{row.note}</p>
            ) : null}
          </div>

          {/* Amounts */}
          <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
            <p className="font-heading text-base font-semibold tabular-nums leading-tight text-foreground">
              {formatCurrency(row.amountFrom, row.currencyFrom)}
            </p>
            {crossCurrency ? (
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                → {formatCurrency(row.amountTo, row.currencyTo)}
              </p>
            ) : null}
          </div>
        </div>

        {/* Always-visible 3-dot menu (also long-press target). */}
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
              Se eliminará la transferencia de{" "}
              <strong>{formatCurrency(row.amountFrom, row.currencyFrom)}</strong>{" "}
              de {row.fromWallet.name} a {row.toWallet.name}.
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
    </>
  );
}
