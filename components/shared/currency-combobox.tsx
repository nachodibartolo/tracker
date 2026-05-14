"use client";

import * as React from "react";
import { Check, CaretDown } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CURRENCIES } from "@/lib/currencies";
import { cn } from "@/lib/utils";

interface CurrencyComboboxProps {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  disabled?: boolean;
}

export function CurrencyCombobox({
  value,
  onChange,
  className,
  disabled,
}: CurrencyComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = CURRENCIES.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-expanded={open}
            className={cn("w-full justify-between font-normal", className)}
          />
        }
      >
        {selected ? (
          <span className="truncate">
            <span className="font-mono text-xs text-muted-foreground">
              {selected.code}
            </span>
            <span className="ml-2">{selected.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Elegí una moneda…</span>
        )}
        <CaretDown className="h-4 w-4 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[var(--anchor-width,18rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar moneda…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {CURRENCIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.code} ${c.name}`}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      c.code === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1">
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.code}
                    </span>
                    <span className="ml-2">{c.name}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
