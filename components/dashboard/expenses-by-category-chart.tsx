"use client";

import * as React from "react";
import { ChartPieSlice } from "@phosphor-icons/react";
import { Cell, Pie, PieChart } from "recharts";

import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getCategoryIcon } from "@/lib/category-icons";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ExpenseCategorySlice {
  /** Stable id for the slice. */
  id: string;
  name: string;
  color: string;
  icon: string;
  totalInMain: number;
}

interface ExpensesByCategoryChartProps {
  data: ExpenseCategorySlice[];
  currency: string;
  className?: string;
}

const FALLBACK_COLOR = "#64748b";

/**
 * Donut chart of this month's expenses by category.
 *
 * Two-layout responsive:
 *   - Mobile (<md): donut on top, top-5 categories listed below with
 *     proportional bar fills (visually similar to a Spotify Wrapped row).
 *   - Desktop (≥md): donut left, full ranked legend right.
 *
 * Empty state surfaces a small illustrative card when nothing was spent
 * this month.
 */
export function ExpensesByCategoryChart({
  data,
  currency,
  className,
}: ExpensesByCategoryChartProps) {
  const total = React.useMemo(
    () => data.reduce((sum, d) => sum + d.totalInMain, 0),
    [data],
  );

  const config = React.useMemo<ChartConfig>(() => {
    const c: ChartConfig = {};
    for (const slice of data) {
      c[slice.id] = {
        label: slice.name,
        color: slice.color || FALLBACK_COLOR,
      };
    }
    return c;
  }, [data]);

  if (data.length === 0) {
    return (
      <Card className={cn("p-6", className)} size="sm">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <ChartPieSlice className="size-6" weight="duotone" />
          </span>
          <p className="text-sm font-medium">{t.dashboard.expensesByCategory}</p>
          <p className="text-xs text-muted-foreground">
            Sin gastos este mes. Cuando carguemos uno, lo vas a ver acá.
          </p>
        </div>
      </Card>
    );
  }

  const top = data.slice(0, 5);
  const max = top[0]?.totalInMain ?? 1;

  return (
    <Card size="sm" className={className}>
      <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:px-5">
        <header className="md:hidden">
          <h2 className="font-heading text-base font-medium">
            {t.dashboard.expensesByCategory}
          </h2>
          <p className="text-xs text-muted-foreground">Este mes</p>
        </header>

        <div className="relative mx-auto w-full max-w-[260px] md:mx-0 md:w-[220px] md:flex-shrink-0">
          <ChartContainer
            config={config}
            className="aspect-square h-[200px] w-full md:h-[220px]"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, _name, item) => {
                      const slice = item?.payload as
                        | ExpenseCategorySlice
                        | undefined;
                      const label = slice?.name ?? "—";
                      return (
                        <div className="flex w-full items-center justify-between gap-3">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-mono font-medium tabular-nums">
                            {formatCurrency(Number(value), currency)}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Pie
                data={data}
                dataKey="totalInMain"
                nameKey="id"
                innerRadius="60%"
                outerRadius="95%"
                paddingAngle={1.5}
                strokeWidth={2}
              >
                {data.map((slice) => (
                  <Cell
                    key={slice.id}
                    fill={slice.color || FALLBACK_COLOR}
                    className="stroke-background"
                  />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          {/* Center label. Compact for ≥1M so the value never overflows the donut hole. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total
            </p>
            <p className="font-heading text-base font-semibold tabular-nums leading-tight whitespace-nowrap">
              {Math.abs(total) >= 1_000_000
                ? formatCompactCurrency(total, currency)
                : formatCurrency(total, currency)}
            </p>
          </div>
        </div>

        {/* Mobile: top-5 list with bars. */}
        <ol className="flex flex-col gap-2 md:hidden">
          {top.map((slice) => (
            <CategoryRow
              key={slice.id}
              slice={slice}
              max={max}
              currency={currency}
            />
          ))}
        </ol>

        {/* Desktop: full legend list. */}
        <div className="hidden flex-1 flex-col gap-3 md:flex">
          <header>
            <h2 className="font-heading text-base font-medium">
              {t.dashboard.expensesByCategory}
            </h2>
            <p className="text-xs text-muted-foreground">Este mes</p>
          </header>
          <ol className="flex flex-col gap-1.5">
            {data.map((slice) => (
              <CategoryRow
                key={slice.id}
                slice={slice}
                max={max}
                currency={currency}
                compact
              />
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}

function CategoryRow({
  slice,
  max,
  currency,
  compact = false,
}: {
  slice: ExpenseCategorySlice;
  max: number;
  currency: string;
  compact?: boolean;
}) {
  const Icon = getCategoryIcon(slice.icon);
  const pct = max > 0 ? Math.max(4, Math.round((slice.totalInMain / max) * 100)) : 0;
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "flex flex-shrink-0 items-center justify-center rounded-full text-white",
          compact ? "size-6" : "size-8",
        )}
        style={{ backgroundColor: slice.color || FALLBACK_COLOR }}
      >
        <Icon
          weight="fill"
          className={compact ? "size-3" : "size-4"}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{slice.name}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatCurrency(slice.totalInMain, currency)}
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: slice.color || FALLBACK_COLOR,
            }}
          />
        </div>
      </div>
    </li>
  );
}
