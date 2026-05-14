"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ColorPicker } from "@/components/shared/color-picker";
import { CurrencyCombobox } from "@/components/shared/currency-combobox";
import { IconPicker } from "@/components/shared/icon-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createWallet,
  updateWallet,
  type ActionResult,
  type WalletInput,
} from "@/actions/wallets";
import { DEFAULT_COLOR } from "@/lib/colors";
import { t } from "@/lib/i18n";
import type { Wallet, WalletType } from "@/lib/supabase/database.types";
import { WALLET_ICONS } from "@/lib/wallet-icons";

const WALLET_TYPES = [
  "general",
  "cash",
  "bank",
  "credit_card",
  "savings",
  "investment",
] as const satisfies readonly WalletType[];

// Client-side validation mirrors the server schema (intentionally redundant
// so the user gets instant feedback before the action runs).
const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(40, "Máximo 40 caracteres"),
  type: z.enum(WALLET_TYPES),
  currency: z
    .string()
    .trim()
    .min(3, "Moneda inválida")
    .max(3, "Moneda inválida"),
  initial_balance: z
    .number({ message: "Saldo inválido" })
    .finite("Saldo inválido"),
  color: z.string().min(1),
  icon: z.string().min(1),
  excluded_from_stats: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface WalletFormProps {
  mode: "create" | "edit";
  wallet?: Wallet;
  onSuccess: (wallet?: Wallet) => void;
  onCancel?: () => void;
}

const DEFAULT_VALUES: FormValues = {
  name: "",
  type: "general",
  currency: "ARS",
  initial_balance: 0,
  color: DEFAULT_COLOR,
  icon: "wallet",
  excluded_from_stats: false,
};

export function WalletForm({ mode, wallet, onSuccess, onCancel }: WalletFormProps) {
  const [pending, startTransition] = React.useTransition();

  const defaultValues: FormValues = React.useMemo(() => {
    if (mode === "edit" && wallet) {
      return {
        name: wallet.name,
        type: wallet.type,
        currency: wallet.currency,
        initial_balance: Number(wallet.initial_balance),
        color: wallet.color,
        icon: wallet.icon,
        excluded_from_stats: wallet.excluded_from_stats,
      };
    }
    return DEFAULT_VALUES;
  }, [mode, wallet]);

  // `@hookform/resolvers@5.x` ships an outdated zod v3 type overload that
  // mismatches against zod 4's `$ZodType` shape (`_zod.version.minor` 0 vs 4).
  // The resolver still works at runtime; cast at the boundary so we can keep
  // strict checks elsewhere in the file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolver = zodResolver(formSchema as any);

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver,
    defaultValues,
  });

  const selectedColor = watch("color");

  function submit(values: FormValues) {
    const payload: WalletInput = {
      name: values.name.trim(),
      type: values.type,
      currency: values.currency.trim().toUpperCase(),
      initial_balance: values.initial_balance,
      color: values.color,
      icon: values.icon,
      excluded_from_stats: values.excluded_from_stats,
    };

    startTransition(async () => {
      let result: ActionResult<Wallet>;
      if (mode === "edit" && wallet) {
        result = await updateWallet(wallet.id, payload);
      } else {
        result = await createWallet(payload);
      }

      if (result.ok) {
        toast.success(mode === "edit" ? t.common.saved : "Wallet creada");
        onSuccess(result.data);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      className="space-y-5 pt-2"
      noValidate
    >
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="wallet-name">{t.wallet.name}</Label>
        <Input
          id="wallet-name"
          type="text"
          autoComplete="off"
          maxLength={40}
          placeholder="Mi billetera"
          aria-invalid={errors.name ? true : undefined}
          {...register("name")}
        />
        {errors.name ? (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        ) : null}
      </div>

      {/* Type */}
      <div className="space-y-2">
        <Label htmlFor="wallet-type">{t.wallet.type}</Label>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
              <SelectTrigger id="wallet-type" className="w-full">
                <SelectValue placeholder="Elegí un tipo" />
              </SelectTrigger>
              <SelectContent>
                {WALLET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t.wallet.types[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {/* Currency */}
      <div className="space-y-2">
        <Label>{t.wallet.currency}</Label>
        <Controller
          control={control}
          name="currency"
          render={({ field }) => (
            <CurrencyCombobox value={field.value} onChange={field.onChange} />
          )}
        />
        {errors.currency ? (
          <p className="text-xs text-destructive">{errors.currency.message}</p>
        ) : null}
      </div>

      {/* Initial balance */}
      <div className="space-y-2">
        <Label htmlFor="wallet-initial">{t.wallet.initialBalance}</Label>
        <Input
          id="wallet-initial"
          type="number"
          step="0.01"
          inputMode="decimal"
          placeholder="0,00"
          aria-invalid={errors.initial_balance ? true : undefined}
          {...register("initial_balance", { valueAsNumber: true })}
        />
        {errors.initial_balance ? (
          <p className="text-xs text-destructive">
            {errors.initial_balance.message}
          </p>
        ) : null}
      </div>

      {/* Color */}
      <div className="space-y-2">
        <Label>{t.wallet.color}</Label>
        <Controller
          control={control}
          name="color"
          render={({ field }) => (
            <ColorPicker value={field.value} onChange={field.onChange} />
          )}
        />
      </div>

      {/* Icon */}
      <div className="space-y-2">
        <Label>{t.wallet.icon}</Label>
        <Controller
          control={control}
          name="icon"
          render={({ field }) => (
            <IconPicker
              options={WALLET_ICONS}
              value={field.value}
              onChange={field.onChange}
              color={selectedColor}
            />
          )}
        />
      </div>

      {/* Excluded from stats */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/30 px-3 py-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="wallet-excluded" className="cursor-pointer">
            {t.wallet.excludeFromStats}
          </Label>
          <p className="text-xs text-muted-foreground">
            No se contará en métricas del dashboard
          </p>
        </div>
        <Controller
          control={control}
          name="excluded_from_stats"
          render={({ field }) => (
            <Switch
              id="wallet-excluded"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked)}
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
        <Button type="submit" disabled={pending} className="min-h-11">
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
