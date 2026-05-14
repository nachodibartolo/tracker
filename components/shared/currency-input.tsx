"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { parseAmountFromString } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CurrencyInputProps {
  value: number | null;
  onChange: (n: number | null) => void;
  currency?: string;
  className?: string;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  "aria-invalid"?: boolean;
  disabled?: boolean;
}

/**
 * Numeric input optimised for es-AR amounts:
 *
 * - Visible string uses comma as the decimal separator (e.g. "1.234,56").
 * - Internal `<input>` is `inputmode="decimal"` so mobile keyboards open a
 *   numeric keypad with both `,` and `.`.
 * - Selects all on focus so retyping over an existing value is one tap.
 * - The currency code is shown as a static suffix when supplied.
 *
 * We keep a string in local state instead of re-formatting on every keystroke
 * because reformatting mid-typing destroys cursor position and confuses users
 * typing decimals. The parsed number is forwarded via `onChange` whenever the
 * raw text yields a finite number.
 */
export function CurrencyInput({
  value,
  onChange,
  currency,
  className,
  placeholder = "0,00",
  id,
  autoFocus,
  "aria-invalid": ariaInvalid,
  disabled,
}: CurrencyInputProps) {
  const [text, setText] = React.useState<string>(() => formatNumberForInput(value));

  // Sync external value -> local text when the controller resets (form.reset
  // in edit mode, or pre-fill). Only overwrite when the parsed local text
  // doesn't already match — otherwise we'd erase the user's in-flight typing.
  React.useEffect(() => {
    const current = parseAmountFromString(text);
    if (value === null && current !== null) {
      setText("");
    } else if (value !== null && current !== value) {
      setText(formatNumberForInput(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(next: string) {
    // Allow only digits, comma, period, minus. Strip everything else so a
    // pasted "$ 1.234,56" still works.
    const cleaned = next.replace(/[^0-9.,-]/g, "");
    setText(cleaned);
    if (cleaned.trim().length === 0) {
      onChange(null);
      return;
    }
    const parsed = parseAmountFromString(cleaned);
    onChange(parsed);
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus={autoFocus}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        className={cn(
          "pr-14 text-right font-mono tabular-nums",
          currency ? undefined : "pr-3",
        )}
      />
      {currency ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs uppercase text-muted-foreground"
        >
          {currency}
        </span>
      ) : null}
    </div>
  );
}

function formatNumberForInput(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  // Use es-AR grouping/decimals but trim trailing zeros so we don't display
  // "100,00" when the user typed "100".
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
  return formatted;
}
