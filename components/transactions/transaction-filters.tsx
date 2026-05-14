"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarBlank,
  CaretDown,
  Check,
  Tag,
  Wallet as WalletIcon,
  X,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FlatCategoryOption } from "@/lib/domain/categories";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TxType, Wallet } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type FilterableType = TxType | "all";

interface TransactionFiltersProps {
  wallets: Pick<Wallet, "id" | "name" | "color">[];
  /** Both lists pre-fetched so a single popover open doesn't re-query. */
  categories: {
    expense: FlatCategoryOption[];
    income: FlatCategoryOption[];
  };
}

/**
 * Filter strip — pill/chips that read and write the page's URL search params.
 *
 * URL schema (handed off to Track 4B for dashboard deep-linking):
 *   `?walletId=<uuid>`
 *   `?categoryId=<uuid>`
 *   `?type=expense|income|transfer`     (omit / `all` clears)
 *   `?fromDate=YYYY-MM-DD`
 *   `?toDate=YYYY-MM-DD`
 *   `?q=<free text>`
 *   `?page=<int>`                       (kept by list page; reset to 0 on
 *                                        filter change)
 *
 * All params survive page reload because the page is server-rendered from
 * `searchParams`.
 */
export function TransactionFilters({
  wallets,
  categories,
}: TransactionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = React.useMemo(
    () => ({
      walletId: searchParams.get("walletId") || "",
      categoryId: searchParams.get("categoryId") || "",
      type: ((searchParams.get("type") as TxType | null) ??
        "all") as FilterableType,
      fromDate: searchParams.get("fromDate") || "",
      toDate: searchParams.get("toDate") || "",
      q: searchParams.get("q") || "",
    }),
    [searchParams],
  );

  const [qDraft, setQDraft] = React.useState(current.q);
  React.useEffect(() => {
    setQDraft(current.q);
  }, [current.q]);

  const pushChange = React.useCallback(
    (patch: Partial<typeof current>) => {
      const params = new URLSearchParams(searchParams.toString());
      const merged = { ...current, ...patch };
      for (const [key, value] of Object.entries(merged)) {
        if (!value || value === "all") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }
      // Any filter change resets pagination.
      params.delete("page");
      const qs = params.toString();
      router.push(qs ? `/transactions?${qs}` : "/transactions");
    },
    [current, router, searchParams],
  );

  const selectedWallet = wallets.find((w) => w.id === current.walletId);
  const visibleCategories = React.useMemo(() => {
    if (current.type === "income") return categories.income;
    if (current.type === "expense") return categories.expense;
    return [...categories.expense, ...categories.income];
  }, [current.type, categories]);
  const selectedCategory = visibleCategories.find(
    (c) => c.id === current.categoryId,
  );

  const hasAnyFilter =
    Boolean(current.walletId) ||
    Boolean(current.categoryId) ||
    current.type !== "all" ||
    Boolean(current.fromDate) ||
    Boolean(current.toDate) ||
    Boolean(current.q);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x">
        {/* Type chip group */}
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted p-1 snap-start">
          <TypeChip
            active={current.type === "all"}
            onClick={() => pushChange({ type: "all", categoryId: "" })}
          >
            Todas
          </TypeChip>
          <TypeChip
            active={current.type === "expense"}
            onClick={() => pushChange({ type: "expense", categoryId: "" })}
          >
            {t.transaction.expense}
          </TypeChip>
          <TypeChip
            active={current.type === "income"}
            onClick={() => pushChange({ type: "income", categoryId: "" })}
          >
            {t.transaction.income}
          </TypeChip>
        </div>

        {/* Wallet popover */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant={current.walletId ? "default" : "outline"}
                size="sm"
                className="shrink-0 snap-start"
              />
            }
          >
            <WalletIcon className="size-4" />
            <span>{selectedWallet?.name ?? t.transaction.wallet}</span>
            <CaretDown className="size-3" />
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <Label className="px-2 pb-2 text-xs text-muted-foreground">
              {t.transaction.wallet}
            </Label>
            <FilterItem
              active={!current.walletId}
              onClick={() => pushChange({ walletId: "" })}
            >
              Todas las wallets
            </FilterItem>
            {wallets.map((w) => (
              <FilterItem
                key={w.id}
                active={w.id === current.walletId}
                onClick={() => pushChange({ walletId: w.id })}
              >
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: w.color }}
                />
                <span className="truncate">{w.name}</span>
              </FilterItem>
            ))}
          </PopoverContent>
        </Popover>

        {/* Category popover */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant={current.categoryId ? "default" : "outline"}
                size="sm"
                className="shrink-0 snap-start"
              />
            }
          >
            <Tag className="size-4" />
            <span>{selectedCategory?.label ?? t.transaction.category}</span>
            <CaretDown className="size-3" />
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <Label className="px-2 pb-2 text-xs text-muted-foreground">
              {t.transaction.category}
            </Label>
            <div className="max-h-72 overflow-y-auto">
              <FilterItem
                active={!current.categoryId}
                onClick={() => pushChange({ categoryId: "" })}
              >
                Todas las categorías
              </FilterItem>
              {visibleCategories.map((c) => (
                <FilterItem
                  key={c.id}
                  active={c.id === current.categoryId}
                  onClick={() => pushChange({ categoryId: c.id })}
                >
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="truncate">{c.label}</span>
                </FilterItem>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Date range popover */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant={
                  current.fromDate || current.toDate ? "default" : "outline"
                }
                size="sm"
                className="shrink-0 snap-start"
              />
            }
          >
            <CalendarBlank className="size-4" />
            <span>
              {current.fromDate || current.toDate
                ? `${current.fromDate ? formatDate(`${current.fromDate}T00:00:00Z`, "d MMM") : "…"} → ${current.toDate ? formatDate(`${current.toDate}T00:00:00Z`, "d MMM") : "…"}`
                : "Fechas"}
            </span>
            <CaretDown className="size-3" />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <Calendar
              mode="range"
              selected={{
                from: current.fromDate ? new Date(`${current.fromDate}T00:00:00Z`) : undefined,
                to: current.toDate ? new Date(`${current.toDate}T00:00:00Z`) : undefined,
              }}
              onSelect={(range) => {
                pushChange({
                  fromDate: range?.from ? toDateKey(range.from) : "",
                  toDate: range?.to ? toDateKey(range.to) : "",
                });
              }}
              numberOfMonths={1}
            />
            {(current.fromDate || current.toDate) && (
              <div className="flex justify-end px-1 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => pushChange({ fromDate: "", toDate: "" })}
                >
                  Limpiar
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {hasAnyFilter ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 snap-start"
            onClick={() =>
              pushChange({
                walletId: "",
                categoryId: "",
                type: "all",
                fromDate: "",
                toDate: "",
                q: "",
              })
            }
          >
            <X className="size-4" />
            <span>Limpiar</span>
          </Button>
        ) : null}
      </div>

      {/* Free-text search — kept on its own row so it doesn't crowd the chip
          strip on narrow screens. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          pushChange({ q: qDraft.trim() });
        }}
      >
        <Input
          type="search"
          inputMode="search"
          placeholder="Buscar por descripción o lugar…"
          value={qDraft}
          onChange={(e) => setQDraft(e.target.value)}
          onBlur={() => {
            if (qDraft.trim() !== current.q) {
              pushChange({ q: qDraft.trim() });
            }
          }}
          className="w-full"
        />
      </form>
    </div>
  );
}

interface TypeChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

function TypeChip({ active, className, children, ...props }: TypeChipProps) {
  return (
    <button
      type="button"
      data-active={active ? "true" : undefined}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition-colors data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

interface FilterItemProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterItem({ active, onClick, children }: FilterItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
        active && "bg-muted",
      )}
    >
      <span className="flex flex-1 items-center gap-2 truncate">{children}</span>
      {active ? <Check className="size-4 text-muted-foreground" /> : null}
    </button>
  );
}

function toDateKey(d: Date): string {
  // YYYY-MM-DD in UTC. Matches the day-grouping convention.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
