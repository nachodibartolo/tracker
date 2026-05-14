// Server-only currency conversion helpers.
// Consumers (Track 3A Transactions, Track 4B Dashboard) should import from
// this module rather than calling `fetchAndCacheRate` directly.
//
// IMPORTANT: this re-exports a code path that hits the service-role client.
// Only import from server components, route handlers, or server actions.

import { fetchAndCacheRate } from "@/lib/fx/rates";

/**
 * Convert a single amount from `from` to `to` using the rate for `date`
 * (defaults to today UTC). Identity conversions skip the cache entirely.
 */
export async function convert(
  amount: number,
  from: string,
  to: string,
  date?: string,
): Promise<number> {
  if (from === to) return amount;
  const rate = await fetchAndCacheRate(from, to, date);
  return amount * rate;
}

/**
 * Convert a list of `{ amount, currency }` items into `to`, batching rate
 * fetches by unique `(currency, to)` pair so we don't re-fetch the same
 * rate for repeated currencies in the same call.
 */
export async function convertMany<T extends { amount: number; currency: string }>(
  items: T[],
  to: string,
  date?: string,
): Promise<Array<T & { converted: number }>> {
  if (items.length === 0) return [];

  const target = to.trim().toUpperCase();

  // Collect unique source currencies that actually need conversion.
  const uniqueCurrencies = new Set<string>();
  for (const item of items) {
    const c = item.currency.trim().toUpperCase();
    if (c !== target) uniqueCurrencies.add(c);
  }

  // Fetch each unique rate once. We do these in parallel because they hit
  // the cache for the same date and only fall through to Frankfurter on
  // genuine cache misses, which are themselves rate-limited at the row level.
  const rateEntries = await Promise.all(
    Array.from(uniqueCurrencies).map(async (currency) => {
      const rate = await fetchAndCacheRate(currency, target, date);
      return [currency, rate] as const;
    }),
  );
  const rates = new Map<string, number>(rateEntries);

  return items.map((item) => {
    const currency = item.currency.trim().toUpperCase();
    if (currency === target) {
      return { ...item, converted: item.amount };
    }
    const rate = rates.get(currency);
    // `rates` always contains every currency in `uniqueCurrencies` because
    // any thrown error would have rejected the Promise.all above.
    const converted = item.amount * (rate as number);
    return { ...item, converted };
  });
}
