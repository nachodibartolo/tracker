"use client";

import * as React from "react";
import { TrendUp } from "@phosphor-icons/react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface BalanceTrendPointInput {
  /** YYYY-MM-DD (UTC). */
  day: string;
  balance: number;
}

interface BalanceTrendChartProps {
  data: BalanceTrendPointInput[];
  currency: string;
  className?: string;
}

/**
 * Area chart of the user's running balance over the last 30 days in
 * `mainCurrency`.
 *
 * Heights differ by viewport: 192px (h-48) on mobile, 256px (h-64) on
 * desktop, to keep the page scroll-friendly on phones.
 *
 * Y axis uses compact currency formatting (`$1,2K` style) so labels stay
 * legible at narrow widths.
 */
export function BalanceTrendChart({
  data,
  currency,
  className,
}: BalanceTrendChartProps) {
  const config = React.useMemo<ChartConfig>(
    () => ({
      balance: {
        label: t.dashboard.totalBalance,
        color: "var(--color-primary)",
      },
    }),
    [],
  );

  const hasData = data.length > 0 && data.some((p) => p.balance !== 0);

  // Pretty-format the day for the tooltip — short, in es-AR.
  const yFormatter = React.useCallback(
    (value: number) => formatCompactCurrency(value, currency),
    [currency],
  );

  // Pre-compute formatted tick labels to display every ~5 days only.
  const ticks = React.useMemo(() => {
    if (data.length === 0) return [];
    const want = 5;
    const step = Math.max(1, Math.floor(data.length / want));
    return data.filter((_, i) => i % step === 0).map((p) => p.day);
  }, [data]);

  return (
    <Card size="sm" className={className}>
      <div className="flex flex-col gap-3 px-4 py-4 md:px-5">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-heading text-base font-medium">
              {t.dashboard.balanceTrend}
            </h2>
            <p className="text-xs text-muted-foreground">Últimos 30 días</p>
          </div>
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <TrendUp className="size-4" weight="duotone" />
          </span>
        </header>

        {hasData ? (
          <ChartContainer
            config={config}
            className={cn("h-48 w-full md:h-64", "aspect-auto")}
          >
            <AreaChart
              data={data}
              margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
            >
              <defs>
                <linearGradient id="balance-trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-balance)"
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-balance)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                ticks={ticks}
                tickFormatter={(value: string) =>
                  formatDate(`${value}T00:00:00Z`, "d MMM")
                }
                minTickGap={20}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                width={56}
                tickFormatter={yFormatter}
              />
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      typeof value === "string"
                        ? formatDate(`${value}T00:00:00Z`, "PPP")
                        : String(value)
                    }
                    formatter={(value) => (
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="text-muted-foreground">
                          {t.dashboard.totalBalance}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatCurrency(Number(value), currency)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="var(--color-balance)"
                strokeWidth={2}
                fill="url(#balance-trend-fill)"
                isAnimationActive={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border text-xs text-muted-foreground md:h-64">
            Necesitamos un par de transacciones para dibujar la curva.
          </div>
        )}
      </div>
    </Card>
  );
}
