"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDown,
  CalendarBlank,
  NotePencil,
  Sparkle,
} from "@phosphor-icons/react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  createTransfer,
  suggestFxRate,
  type ActionResult,
  type TransferInput,
} from "@/actions/transfers";
import { CurrencyInput } from "@/components/shared/currency-input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Wallet } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type TransferFormWallet = Pick<
  Wallet,
  "id" | "name" | "currency" | "color" | "icon"
> & {
  balance?: number;
};

// Local form schema — mirrors the server action's zod schema but works in
// number-friendly state shape. Validation is reproduced client-side for
// instant feedback; server action remains the source of truth.
const formSchema = z.object({
  from_wallet_id: z.string().uuid("Wallet de origen inválida"),
  to_wallet_id: z.string().uuid("Wallet de destino inválida"),
  amount_from: z
    .number({ message: "Monto inválido" })
    .finite("Monto inválido")
    .positive("Ingresá un monto mayor a 0"),
  amount_to: z
    .number({ message: "Monto recibido inválido" })
    .finite("Monto recibido inválido")
    .positive("Ingresá un monto recibido mayor a 0"),
  fx_rate: z
    .number()
    .finite()
    .positive()
    .nullable(),
  occurred_at: z.string().min(1, "Fecha inválida"),
  note: z.string().trim().max(500).nullable(),
});

type FormValues = z.infer<typeof formSchema>;

interface TransferFormProps {
  wallets: TransferFormWallet[];
  onSuccess: () => void;
  onCancel?: () => void;
}

type DateChip = "today" | "yesterday" | "custom";

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

function safeMul(a: number, b: number): number {
  // Avoid floating-point drift accumulating in rapid-fire onChange handlers.
  // Two decimals is the canonical precision for monetary amounts in this app.
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round(a * b * 100) / 100;
}

function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return Math.round((a / b) * 1_000_000) / 1_000_000;
}

/**
 * Two-leg transfer form (create only). Same-currency transfers hide the rate
 * field and lock `amount_to = amount_from`; cross-currency transfers expose
 * a bi-directional Rate ↔ Recibís pair so editing either updates the other.
 */
export function TransferForm({ wallets, onSuccess, onCancel }: TransferFormProps) {
  const [pending, startTransition] = React.useTransition();
  const [showNote, setShowNote] = React.useState(false);
  const [suggesting, setSuggesting] = React.useState(false);
  // Tracks which field the user last edited, so the bi-directional binding
  // can derive the other without bouncing back and forth.
  const lastEditedRef = React.useRef<"amount_to" | "rate">("rate");

  const defaultValues: FormValues = React.useMemo(
    () => ({
      from_wallet_id: wallets[0]?.id ?? "",
      to_wallet_id: wallets.find((w) => w.id !== wallets[0]?.id)?.id ?? "",
      amount_from: 0,
      amount_to: 0,
      fx_rate: null,
      occurred_at: new Date().toISOString(),
      note: null,
    }),
    [wallets],
  );

  const {
    control,
    handleSubmit,
    register,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema as any),
    defaultValues,
  });

  const fromWalletId = watch("from_wallet_id");
  const toWalletId = watch("to_wallet_id");
  const amountFrom = watch("amount_from");
  const amountTo = watch("amount_to");
  const fxRate = watch("fx_rate");
  const occurredAt = watch("occurred_at");

  const fromWallet = React.useMemo(
    () => wallets.find((w) => w.id === fromWalletId) ?? null,
    [wallets, fromWalletId],
  );
  const toWallet = React.useMemo(
    () => wallets.find((w) => w.id === toWalletId) ?? null,
    [wallets, toWalletId],
  );

  const sameCurrency =
    !!fromWallet && !!toWallet && fromWallet.currency === toWallet.currency;

  // When the user picks the same wallet twice, auto-shift the destination.
  React.useEffect(() => {
    if (fromWalletId && fromWalletId === toWalletId) {
      const next = wallets.find((w) => w.id !== fromWalletId);
      if (next) setValue("to_wallet_id", next.id, { shouldDirty: true });
    }
  }, [fromWalletId, toWalletId, wallets, setValue]);

  // Same-currency transfers force amount_to = amount_from and rate = 1.
  React.useEffect(() => {
    if (sameCurrency) {
      setValue("amount_to", amountFrom, { shouldDirty: true });
      setValue("fx_rate", 1, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sameCurrency, amountFrom]);

  // Cross-currency: when the rate is the last-edited field, derive amount_to.
  // When amount_to is the last-edited field, derive the rate.
  React.useEffect(() => {
    if (sameCurrency) return;
    if (!amountFrom || amountFrom <= 0) return;
    if (lastEditedRef.current === "rate" && fxRate && fxRate > 0) {
      const derived = safeMul(amountFrom, fxRate);
      if (derived !== amountTo) {
        setValue("amount_to", derived, { shouldDirty: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sameCurrency, amountFrom, fxRate]);

  function onChangeAmountTo(value: number | null) {
    lastEditedRef.current = "amount_to";
    const next = value ?? 0;
    setValue("amount_to", next, { shouldDirty: true });
    if (!sameCurrency && amountFrom > 0 && next > 0) {
      setValue("fx_rate", safeDiv(next, amountFrom), { shouldDirty: true });
    }
  }

  function onChangeRate(value: number | null) {
    lastEditedRef.current = "rate";
    setValue("fx_rate", value, { shouldDirty: true });
  }

  async function handleSuggestRate() {
    if (!fromWallet || !toWallet) return;
    setSuggesting(true);
    try {
      const res = await suggestFxRate(fromWallet.currency, toWallet.currency);
      if (res.ok && res.data) {
        lastEditedRef.current = "rate";
        setValue("fx_rate", res.data.rate, { shouldDirty: true });
        toast.success(`Tasa del ${res.data.date}`);
      } else {
        toast.error(res.ok ? "No se pudo obtener la tasa" : res.error);
      }
    } finally {
      setSuggesting(false);
    }
  }

  const dateChip: DateChip = React.useMemo(() => {
    if (!occurredAt) return "custom";
    return classifyDate(occurredAt);
  }, [occurredAt]);

  function setDayChip(chip: DateChip) {
    if (chip === "today") {
      setValue("occurred_at", new Date().toISOString(), { shouldDirty: true });
    } else if (chip === "yesterday") {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      setValue("occurred_at", d.toISOString(), { shouldDirty: true });
    }
  }

  function submit(values: FormValues) {
    if (!values.from_wallet_id || !values.to_wallet_id) {
      toast.error("Elegí ambas wallets");
      return;
    }
    if (values.from_wallet_id === values.to_wallet_id) {
      toast.error("Las wallets deben ser distintas");
      return;
    }
    if (!fromWallet || !toWallet) {
      toast.error("Wallets inválidas");
      return;
    }

    const payload: TransferInput = {
      from_wallet_id: values.from_wallet_id,
      to_wallet_id: values.to_wallet_id,
      amount_from: values.amount_from,
      amount_to: sameCurrency ? values.amount_from : values.amount_to,
      fx_rate: sameCurrency ? 1 : values.fx_rate ?? undefined,
      occurred_at: values.occurred_at,
      note: values.note,
    };

    if (!sameCurrency && (!payload.fx_rate || payload.fx_rate <= 0)) {
      toast.error("Ingresá una tasa válida");
      return;
    }

    startTransition(async () => {
      const result: ActionResult<{ id: string }> = await createTransfer(payload);
      if (result.ok) {
        toast.success("Transferencia creada");
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  }

  const noViableWallets = wallets.length < 2;

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5 pt-2" noValidate>
      {noViableWallets ? (
        <p className="rounded-xl border border-dashed border-border bg-card/30 px-3 py-3 text-xs text-muted-foreground">
          Necesitás al menos dos wallets para crear una transferencia.
        </p>
      ) : null}

      {/* From wallet */}
      <div className="space-y-2">
        <Label htmlFor="tr-from">{t.transfer.fromWallet}</Label>
        <Controller
          control={control}
          name="from_wallet_id"
          render={({ field }) => (
            <Select
              value={field.value || undefined}
              onValueChange={(v) => field.onChange(v)}
            >
              <SelectTrigger id="tr-from" className="w-full">
                <SelectValue placeholder="Elegí origen" />
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
                      {typeof w.balance === "number"
                        ? formatCurrency(w.balance, w.currency)
                        : w.currency}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {/* Visual chevron between source/destination */}
      <div className="flex justify-center" aria-hidden>
        <span className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          <ArrowDown className="size-4" weight="bold" />
        </span>
      </div>

      {/* To wallet */}
      <div className="space-y-2">
        <Label htmlFor="tr-to">{t.transfer.toWallet}</Label>
        <Controller
          control={control}
          name="to_wallet_id"
          render={({ field }) => (
            <Select
              value={field.value || undefined}
              onValueChange={(v) => field.onChange(v)}
            >
              <SelectTrigger id="tr-to" className="w-full">
                <SelectValue placeholder="Elegí destino" />
              </SelectTrigger>
              <SelectContent>
                {wallets
                  .filter((w) => w.id !== fromWalletId)
                  .map((w) => (
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
      </div>

      {/* Amount from */}
      <div className="space-y-2">
        <Label htmlFor="tr-amount-from">{t.transfer.amount}</Label>
        <Controller
          control={control}
          name="amount_from"
          render={({ field }) => (
            <CurrencyInput
              id="tr-amount-from"
              value={field.value || null}
              onChange={(n) => field.onChange(n ?? 0)}
              currency={fromWallet?.currency}
              aria-invalid={errors.amount_from ? true : undefined}
              autoFocus
            />
          )}
        />
        {errors.amount_from ? (
          <p className="text-xs text-destructive">{errors.amount_from.message}</p>
        ) : null}
      </div>

      {/* Cross-currency: rate + derived "Recibís" */}
      {!sameCurrency && fromWallet && toWallet ? (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="tr-rate">
                {t.transfer.rate}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  ({fromWallet.currency} → {toWallet.currency})
                </span>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSuggestRate}
                disabled={suggesting}
                className="h-7 gap-1 px-2 text-xs"
              >
                <Sparkle className="size-3.5" weight="fill" />
                {suggesting ? "Buscando…" : "Sugerir tasa"}
              </Button>
            </div>
            <CurrencyInput
              id="tr-rate"
              value={fxRate}
              onChange={onChangeRate}
              currency={toWallet.currency}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-amount-to">{t.transfer.amountTo}</Label>
            <CurrencyInput
              id="tr-amount-to"
              value={amountTo || null}
              onChange={onChangeAmountTo}
              currency={toWallet.currency}
              aria-invalid={errors.amount_to ? true : undefined}
            />
            {errors.amount_to ? (
              <p className="text-xs text-destructive">{errors.amount_to.message}</p>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Date */}
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

      {/* Note */}
      <div className="space-y-2">
        {showNote ? (
          <>
            <Label htmlFor="tr-note">{t.transfer.note}</Label>
            <Textarea
              id="tr-note"
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
            className={cn(
              "h-9 gap-2 px-2 text-muted-foreground hover:text-foreground",
            )}
          >
            <NotePencil className="size-4" />
            <span>Agregar nota</span>
          </Button>
        )}
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
          disabled={pending || noViableWallets}
          className="min-h-11"
        >
          {pending ? "Guardando…" : t.actions.create}
        </Button>
      </div>
    </form>
  );
}
