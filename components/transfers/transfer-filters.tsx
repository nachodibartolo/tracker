"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarBlank, CaretDown, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";

/**
 * Date-range filter strip for the transfers page. Keeps the URL contract
 * minimal — Track 4B can read the same `fromDate`/`toDate` keys if it ever
 * deep-links into the transfers list.
 *
 * URL schema:
 *   `?fromDate=YYYY-MM-DD`
 *   `?toDate=YYYY-MM-DD`
 *   `?page=<int>` (managed by the list page; reset to 0 on filter change)
 */
export function TransferFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = React.useMemo(
    () => ({
      fromDate: searchParams.get("fromDate") || "",
      toDate: searchParams.get("toDate") || "",
    }),
    [searchParams],
  );

  const pushChange = React.useCallback(
    (patch: Partial<typeof current>) => {
      const params = new URLSearchParams(searchParams.toString());
      const merged = { ...current, ...patch };
      for (const [key, value] of Object.entries(merged)) {
        if (!value) params.delete(key);
        else params.set(key, String(value));
      }
      params.delete("page");
      const qs = params.toString();
      router.push(qs ? `/transfers?${qs}` : "/transfers");
    },
    [current, router, searchParams],
  );

  const hasAnyFilter = Boolean(current.fromDate) || Boolean(current.toDate);

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant={hasAnyFilter ? "default" : "outline"}
              size="sm"
              className="shrink-0 snap-start"
            />
          }
        >
          <CalendarBlank className="size-4" />
          <span>
            {hasAnyFilter
              ? `${current.fromDate ? formatDate(`${current.fromDate}T00:00:00Z`, "d MMM") : "…"} → ${current.toDate ? formatDate(`${current.toDate}T00:00:00Z`, "d MMM") : "…"}`
              : "Fechas"}
          </span>
          <CaretDown className="size-3" />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Calendar
            mode="range"
            selected={{
              from: current.fromDate
                ? new Date(`${current.fromDate}T00:00:00Z`)
                : undefined,
              to: current.toDate
                ? new Date(`${current.toDate}T00:00:00Z`)
                : undefined,
            }}
            onSelect={(range) => {
              pushChange({
                fromDate: range?.from ? toDateKey(range.from) : "",
                toDate: range?.to ? toDateKey(range.to) : "",
              });
            }}
            numberOfMonths={1}
          />
          {hasAnyFilter ? (
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
          ) : null}
        </PopoverContent>
      </Popover>

      {hasAnyFilter ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 snap-start"
          onClick={() => pushChange({ fromDate: "", toDate: "" })}
        >
          <X className="size-4" />
          <span>Limpiar</span>
        </Button>
      ) : null}
    </div>
  );
}

function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
