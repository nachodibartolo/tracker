import { format as fmtDate, formatRelative } from "date-fns";
import { es } from "date-fns/locale";

export function formatDate(
  d: Date | string | number,
  pattern: string = "PPP",
): string {
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  return fmtDate(date, pattern, { locale: es });
}

export function formatRelativeDate(d: Date | string | number): string {
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  return formatRelative(date, new Date(), { locale: es });
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if Intl rejects the currency code
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatCompactCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatCurrency(amount, currency);
  }
}

export function parseAmountFromString(input: string): number | null {
  const cleaned = input.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
