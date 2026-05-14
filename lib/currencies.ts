// ISO 4217 currencies que el usuario probablemente va a usar.
// Para mantener la combobox manejable; podemos ampliar después.

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: "ARS", name: "Peso argentino", symbol: "$" },
  { code: "USD", name: "Dólar estadounidense", symbol: "US$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "BRL", name: "Real brasileño", symbol: "R$" },
  { code: "UYU", name: "Peso uruguayo", symbol: "$U" },
  { code: "CLP", name: "Peso chileno", symbol: "CLP$" },
  { code: "PEN", name: "Sol peruano", symbol: "S/" },
  { code: "MXN", name: "Peso mexicano", symbol: "MX$" },
  { code: "COP", name: "Peso colombiano", symbol: "CO$" },
  { code: "GBP", name: "Libra esterlina", symbol: "£" },
  { code: "JPY", name: "Yen japonés", symbol: "¥" },
  { code: "CHF", name: "Franco suizo", symbol: "Fr." },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

const codeSet = new Set(CURRENCIES.map((c) => c.code));
export function isKnownCurrency(code: string): boolean {
  return codeSet.has(code);
}

const map = new Map(CURRENCIES.map((c) => [c.code, c]));
export function getCurrency(code: string): CurrencyOption | undefined {
  return map.get(code);
}
