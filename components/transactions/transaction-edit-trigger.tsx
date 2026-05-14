"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DotsThreeVertical, Pencil, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import { deleteTransaction } from "@/actions/transactions";
import { ResponsiveModal } from "@/components/shared/responsive-modal";
import {
  TransactionForm,
  type CategoryOptionsByType,
} from "@/components/transactions/transaction-form";
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
import { t } from "@/lib/i18n";
import type { Transaction, Wallet } from "@/lib/supabase/database.types";

interface TransactionEditTriggerProps {
  transaction: Transaction;
  wallets: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">[];
  categoryOptions: CategoryOptionsByType;
}

/**
 * Edit/Delete dropdown for a single transaction, including the in-place
 * modal that renders the form pre-filled. Lives in the detail page header
 * (mobile + desktop) so the page itself can stay server-rendered.
 */
export function TransactionEditTrigger({
  transaction,
  wallets,
  categoryOptions,
}: TransactionEditTriggerProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const handleDelete = React.useCallback(() => {
    startTransition(async () => {
      const result = await deleteTransaction(transaction.id);
      if (result.ok) {
        toast.success(t.common.deleted);
        setConfirmOpen(false);
        router.push("/transactions");
      } else {
        toast.error(result.error);
      }
    });
  }, [transaction.id, router]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Acciones de transacción"
              className="rounded-full"
            />
          }
        >
          <DotsThreeVertical weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil />
            {t.actions.edit}
          </DropdownMenuItem>
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

      <ResponsiveModal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t.transaction.edit}
      >
        <TransactionForm
          mode="edit"
          wallets={wallets}
          categoryOptions={categoryOptions}
          transaction={transaction}
          onSuccess={() => {
            setEditOpen(false);
            router.refresh();
          }}
          onCancel={() => setEditOpen(false)}
        />
      </ResponsiveModal>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.common.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              La transacción se eliminará permanentemente.
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
