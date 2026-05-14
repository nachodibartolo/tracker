"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowCounterClockwise,
  DotsThreeVertical,
  Pencil,
  Trash,
} from "@phosphor-icons/react";
import { toast } from "sonner";

import { ResponsiveModal } from "@/components/shared/responsive-modal";
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
import { WalletForm } from "@/components/wallets/wallet-form";
import {
  archiveWallet,
  deleteWallet,
  unarchiveWallet,
} from "@/actions/wallets";
import { t } from "@/lib/i18n";
import type { Wallet } from "@/lib/supabase/database.types";

interface WalletActionsMenuProps {
  wallet: Wallet;
  /** Where to navigate after a successful destructive action. */
  onDeleted?: () => void;
}

export function WalletActionsMenu({ wallet, onDeleted }: WalletActionsMenuProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const handleArchive = React.useCallback(() => {
    startTransition(async () => {
      const result = wallet.archived
        ? await unarchiveWallet(wallet.id)
        : await archiveWallet(wallet.id);
      if (result.ok) {
        toast.success(
          wallet.archived ? "Wallet desarchivada" : "Wallet archivada",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }, [wallet.archived, wallet.id, router]);

  const handleDelete = React.useCallback(() => {
    startTransition(async () => {
      const result = await deleteWallet(wallet.id);
      if (result.ok) {
        toast.success(t.common.deleted);
        setConfirmOpen(false);
        if (onDeleted) {
          onDeleted();
        } else {
          router.refresh();
        }
      } else {
        toast.error(result.error);
      }
    });
  }, [wallet.id, onDeleted, router]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Acciones de ${wallet.name}`}
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
          <DropdownMenuItem onClick={handleArchive} disabled={pending}>
            {wallet.archived ? <ArrowCounterClockwise /> : <Archive />}
            {wallet.archived ? t.actions.unarchive : t.actions.archive}
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
        title={t.wallet.edit}
      >
        <WalletForm
          mode="edit"
          wallet={wallet}
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
              Se eliminará <strong>{wallet.name}</strong>. Si tiene
              transacciones asociadas, archivala en su lugar.
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
