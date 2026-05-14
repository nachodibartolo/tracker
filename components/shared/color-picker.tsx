"use client";

import { PALETTE } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <div className={cn("grid grid-cols-9 gap-2", className)}>
      {PALETTE.map((color) => {
        const active = color.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            aria-label={`Color ${color}`}
            aria-pressed={active}
            className={cn(
              "h-9 w-9 rounded-full border-2 transition-transform",
              active
                ? "border-foreground scale-110"
                : "border-transparent hover:scale-105",
            )}
            style={{ backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}
