"use client";

import { type Icon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

interface IconPickerProps {
  options: readonly { name: string; component: Icon }[];
  value: string;
  onChange: (name: string) => void;
  color?: string;
  className?: string;
}

export function IconPicker({
  options,
  value,
  onChange,
  color,
  className,
}: IconPickerProps) {
  return (
    <div className={cn("grid grid-cols-7 gap-2", className)}>
      {options.map(({ name, component: IconComp }) => {
        const active = name === value;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            aria-label={`Ícono ${name}`}
            aria-pressed={active}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg border transition-colors",
              active
                ? "border-foreground bg-accent"
                : "border-border hover:bg-muted",
            )}
          >
            <IconComp
              className="h-5 w-5"
              weight={active ? "fill" : "regular"}
              style={color ? { color: active ? color : undefined } : undefined}
            />
          </button>
        );
      })}
    </div>
  );
}
