"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarBlank, NotePencil } from "@phosphor-icons/react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  createTransaction,
  updateTransaction,
  type ActionResult,
} from "@/actions/transactions";
import { PhotoUpload } from "@/components/transactions/photo-upload";
import { CurrencyInput } from "@/components/shared/currency-input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { FlatCategoryOption } from "@/lib/domain/categories";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Transaction, Wallet } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const TX_TYPES = ["expense", "income"] as const;

const formSchema = z.object({
  wallet_id: z.string().uuid("Wallet inválida"),
  category_id: z.string().uuid().nullable(),
  type: z.enum(TX_TYPES),
  amount: z
    .number({ message: "Monto inválido" })
    .finite("Monto inválido")
    .positive("Ingresá un monto mayor a 0"),
  occurred_at: z.string().min(1, "Fecha inválida"),
  description: z.string().trim().max(200).nullable(),
  payee: z.string().trim().max(100).nullable(),
  note: z.string().trim().max(500).nullable(),
  photo_path: z.string().trim().max(300).nullable(),
});

type FormValues = z.infer<typeof formSchema>;

export interface CategoryOptionsByType {
  expense: FlatCategoryOption[];
  income: FlatCategoryOption[];
}

interface TransactionFormProps {
  mode: "create" | "edit";
  /** All non-archived wallets the user can post against. */
  wallets: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">[];
  /**
   * Categories for each type, fetched server-side and passed in. The form
   * filters by the active tab — pre-fetching both lists keeps tab-switching
   * instant without extra round-trips.
   */
  categoryOptions: CategoryOptionsByType;
  /** Existing transaction for edit mode. */
  transaction?: Transaction;
  onSuccess: () => void;
  onCancel?: () => void;
}

const NO_CATEGORY = "__none__";

type DateChip = "today" | "yesterday" | "custom";

/**
 * The transaction form lives inside `<ResponsiveModal>`. Categories for both
 * tx types are passed in pre-fetched (`categoryOptions`) so flipping the
 * Gasto/Ingreso tab is instant.
 *
 * `as never` cast on the resolver is the same workaround the wallets and
 * categories forms use (zodResolver v5 types mismatch zod v4 — runtime fine).
 */
export function TransactionForm({
  mode,
  wallets,
  categoryOptions,
  transaction,
  onSuccess,
  onCancel,
}: TransactionFormProps) {
  const [pending, startTransition] = React.useTransition();
  const [showNote, setShowNote] = React.useState<boolean>(
    Boolean(transaction?.note),
  );

  const defaultValues: FormValues = React.useMemo(() => {
    if (mode === "edit" && transaction) {
      return {
        wallet_id: transaction.wallet_id,
        category_id: transaction.category_id,
        type: transaction.type === "transfer" ? "expense" : transaction.type,
        amount: Number(transaction.amount),
        occurred_at: new Date(transaction.occurred_at).toISOString(),
        description: transaction.description ?? null,
        payee: transaction.payee ?? null,
        note: transaction.note ?? null,
        photo_path: transaction.photo_path ?? null,
      };
    }
    return {
      wallet_id: wallets[0]?.id ?? "",
      category_id: null,
      type: "expense",
      amount: 0,
      occurred_at: new Date().toISOString(),
      description: null,
      payee: null,
      note: null,
      photo_path: null,
    };
  }, [mode, transaction, wallets]);

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    // See wallets/categories forms — `as never` works around the @hookform
    // resolver typings vs zod 4.
    resolver: zodResolver(formSchema as never),
    defaultValues,
  });

  const selectedType = watch("type");
  const selectedWalletId = watch("wallet_id");
  const selectedOccurredAt = watch("occurred_at");

  const selectedWallet = React.useMemo(
    () => wallets.find((w) => w.id === selectedWalletId),
    [wallets, selectedWalletId],
  );

  const categories = categoryOptions[selectedType];

  // Reset the chosen category when the type tab flips to one whose options
  // don't include the current category.
  React.useEffect(() => {
    const current = watch("category_id");
    if (!current) return;
    const stillValid = categories.some((c) => c.id === current);
    if (!stillValid) {
      setValue("category_id", null, { shouldDirty: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, categories]);

  const dateChip: DateChip = React.useMemo(() => {
    if (!selectedOccurredAt) return "custom";
    return classifyDate(selectedOccurredAt);
  }, [selectedOccurredAt]);

  function setDayChip(chip: DateChip) {
    if (chip === "today") {
      setValue("occurred_at", new Date().toISOString(), { shouldDirty: true });
    } else if (chip === "yesterday") {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      setValue("occurred_at", d.toISOString(), { shouldDirty: true });
    }
    // 'custom' is set via the calendar popover.
  }

  function submit(values: FormValues) {
    if (!values.wallet_id) {
      toast.error("Elegí una wallet");
      return;
    }

    const payload = {
      wallet_id: values.wallet_id,
      category_id: values.category_id,
      type: values.type,
      amount: values.amount,
      occurred_at: values.occurred_at,
      description: values.description,
      payee: values.payee,
      note: values.note,
      photo_path: values.photo_path,
    };

    startTransition(async () => {
      let result: ActionResult;
      if (mode === "edit" && transaction) {
        result = await updateTransaction(transaction.id, payload);
      } else {
        result = await createTransaction(payload);
      }
      if (result.ok) {
        toast.success(mode === "edit" ? t.common.saved : "Transacción creada");
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5 pt-2" noValidate>
      {/* Type tabs */}
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <Tabs
            value={field.value}
            onValueChange={(v) => field.onChange(v)}
            className="w-full"
          >
            <TabsList className="w-full">
              <TabsTrigger value="expense" className="flex-1">
                {t.transaction.expense}
              </TabsTrigger>
              <TabsTrigger value="income" className="flex-1">
                {t.transaction.income}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />

      {/* Amount */}
      <div className="space-y-2">
        <Label htmlFor="tx-amount">{t.transaction.amount}</Label>
        <Controller
          control={control}
          name="amount"
          render={({ field }) => (
            <CurrencyInput
              id="tx-amount"
              value={field.value || null}
              onChange={(n) => field.onChange(n ?? 0)}
              currency={selectedWallet?.currency}
              aria-invalid={errors.amount ? true : undefined}
              autoFocus={mode === "create"}
            />
          )}
        />
        {errors.amount ? (
          <p className="text-xs text-destructive">{errors.amount.message}</p>
        ) : null}
      </div>

      {/* Wallet */}
      <div className="space-y-2">
        <Label htmlFor="tx-wallet">{t.transaction.wallet}</Label>
        {wallets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/30 px-3 py-3 text-xs text-muted-foreground">
            Creá una wallet primero para poder cargar transacciones.
          </p>
        ) : (
          <Controller
            control={control}
            name="wallet_id"
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={(v) => field.onChange(v)}
              >
                <SelectTrigger id="tx-wallet" className="w-full">
                  <SelectValue placeholder="Elegí una wallet" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: w.color }}
                      />
                      <span className="flex-1 truncate">{w.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {w.currency}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label htmlFor="tx-category">{t.transaction.category}</Label>
        <Controller
          control={control}
          name="category_id"
          render={({ field }) => (
            <Select
              value={field.value ?? NO_CATEGORY}
              onValueChange={(v) =>
                field.onChange(v === NO_CATEGORY ? null : (v as string))
              }
            >
              <SelectTrigger id="tx-category" className="w-full">
                <SelectValue placeholder="Sin categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Sin categoría</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="truncate">{c.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {/* Date row */}
      <div className="space-y-2">
        <Label>{t.transaction.date}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={dateChip === "today" ? "default" : "outline"}
            size="sm"
            onClick={() => setDayChip("today")}
          >
            {t.transaction.today}
          </Button>
          <Button
            type="button"
            variant={dateChip === "yesterday" ? "default" : "outline"}
            size="sm"
            onClick={() => setDayChip("yesterday")}
          >
            {t.transaction.yesterday}
          </Button>
          <Controller
            control={control}
            name="occurred_at"
            render={({ field }) => (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant={dateChip === "custom" ? "default" : "outline"}
                      size="sm"
                    />
                  }
                >
                  <CalendarBlank className="size-4" />
                  <span>
                    {dateChip === "custom" && field.value
                      ? formatDate(field.value, "d 'de' MMM")
                      : t.transaction.pickDate}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value ? new Date(field.value) : undefined}
                    onSelect={(d) => {
                      if (!d) return;
                      // Preserve the time portion (keeps "today" semantics
                      // sensible if the user later flips back to chip).
                      const next = new Date(d);
                      const now = new Date();
                      next.setHours(now.getHours(), now.getMinutes(), 0, 0);
                      field.onChange(next.toISOString());
                    }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            )}
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="tx-description">{t.transaction.description}</Label>
        <Input
          id="tx-description"
          type="text"
          autoComplete="off"
          maxLength={200}
          placeholder="Ej. Almuerzo"
          {...register("description", {
            setValueAs: (v) => (typeof v === "string" && v.trim() === "" ? null : v),
          })}
        />
      </div>

      {/* Payee */}
      <div className="space-y-2">
        <Label htmlFor="tx-payee">{t.transaction.payee}</Label>
        <Input
          id="tx-payee"
          type="text"
          autoComplete="off"
          maxLength={100}
          placeholder="Ej. Carrefour"
          {...register("payee", {
            setValueAs: (v) => (typeof v === "string" && v.trim() === "" ? null : v),
          })}
        />
      </div>

      {/* Note (collapsible) */}
      <div className="space-y-2">
        {showNote ? (
          <>
            <Label htmlFor="tx-note">{t.transaction.note}</Label>
            <Textarea
              id="tx-note"
              maxLength={500}
              placeholder="Notas adicionales…"
              {...register("note", {
                setValueAs: (v) =>
                  typeof v === "string" && v.trim() === "" ? null : v,
              })}
            />
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowNote(true)}
            className={cn("h-9 gap-2 px-2 text-muted-foreground hover:text-foreground")}
          >
            <NotePencil className="size-4" />
            <span>Agregar nota</span>
          </Button>
        )}
      </div>

      {/* Photo */}
      <div className="space-y-2">
        <Label>{t.transaction.photo}</Label>
        <Controller
          control={control}
          name="photo_path"
          render={({ field }) => (
            <PhotoUpload
              value={field.value}
              onPhotoChange={(p) => field.onChange(p)}
            />
          )}
        />
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className="min-h-11"
          >
            {t.actions.cancel}
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={pending || wallets.length === 0}
          className="min-h-11"
        >
          {pending
            ? "Guardando…"
            : mode === "edit"
              ? t.actions.save
              : t.actions.create}
        </Button>
      </div>
    </form>
  );
}

function classifyDate(iso: string): DateChip {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "custom";
  const today = new Date();
  if (isSameDay(d, today)) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, yesterday)) return "yesterday";
  return "custom";
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
