// Server-only FX rate utilities.
// Uses Frankfurter (ECB) as data source and caches results in `fx_rates`.
// Writes go through the service-role admin client because the cron has no
// user session and the table's RLS policy only allows authenticated reads.
//
// IMPORTANT: this module imports `lib/supabase/admin`, which requires the
// service-role key. Do NOT import this file from any client component.

import { createAdminClient } from "@/lib/supabase/admin";

export interface FxRateRecord {
  rate_date: string;
  base: string;
  quote: string;
  rate: number;
}

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

export class FxFetchError extends Error {
  readonly base: string;
  readonly quote: string;
  readonly date: string;
  readonly status?: number;
  constructor(
    message: string,
    opts: { base: string; quote: string; date: string; status?: number },
  ) {
    super(message);
    this.name = "FxFetchError";
    this.base = opts.base;
    this.quote = opts.quote;
    this.date = opts.date;
    this.status = opts.status;
  }
}

const FRANKFURTER_BASE = "https://api.frankfurter.app";

function todayUtcIso(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDate(date?: string): string {
  if (!date) return todayUtcIso();
  // Already YYYY-MM-DD? Trust it. Otherwise coerce through Date and re-format.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return todayUtcIso();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function normalizeCurrency(code: string): string {
  return code.trim().toUpperCase();
}

function isTodayOrLater(isoDate: string): boolean {
  return isoDate >= todayUtcIso();
}

async function callFrankfurter(
  base: string,
  quote: string,
  date: string,
): Promise<FrankfurterResponse> {
  // Use "latest" for today (or future) — it's the same endpoint but lets
  // Frankfurter return the freshest published rate without us guessing the
  // last business day.
  const segment = isTodayOrLater(date) ? "latest" : date;
  const url = `${FRANKFURTER_BASE}/${segment}?from=${encodeURIComponent(
    base,
  )}&to=${encodeURIComponent(quote)}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    console.error("[fx] Frankfurter network error", {
      base,
      quote,
      date,
      message,
    });
    throw new FxFetchError(`Frankfurter network error: ${message}`, {
      base,
      quote,
      date,
    });
  }

  if (!res.ok) {
    console.error("[fx] Frankfurter HTTP error", {
      base,
      quote,
      date,
      status: res.status,
    });
    throw new FxFetchError(`Frankfurter HTTP ${res.status}`, {
      base,
      quote,
      date,
      status: res.status,
    });
  }

  const json = (await res.json()) as FrankfurterResponse;
  const rate = json?.rates?.[quote];
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    console.error("[fx] Frankfurter returned no rate", { base, quote, date, json });
    throw new FxFetchError("Frankfurter returned no rate for the requested pair", {
      base,
      quote,
      date,
    });
  }
  return json;
}

async function readCachedRate(
  base: string,
  quote: string,
  date: string,
): Promise<number | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("fx_rates")
    .select("rate")
    .eq("rate_date", date)
    .eq("base", base)
    .eq("quote", quote)
    .maybeSingle();
  if (error) {
    console.error("[fx] cache read failed", {
      base,
      quote,
      date,
      message: error.message,
    });
    return null;
  }
  return data ? Number(data.rate) : null;
}

async function writeCachedRates(rows: FxRateRecord[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("fx_rates")
    .upsert(rows, { onConflict: "rate_date,base,quote", ignoreDuplicates: true });
  if (error) {
    console.error("[fx] cache write failed", { rows: rows.length, message: error.message });
  }
}

/**
 * Fetch (or read from cache) a single FX rate.
 *
 * `date` defaults to today (UTC) when omitted. When `base === quote` we
 * short-circuit to `1` without touching the DB or Frankfurter.
 */
export async function fetchAndCacheRate(
  base: string,
  quote: string,
  date?: string,
): Promise<number> {
  const b = normalizeCurrency(base);
  const q = normalizeCurrency(quote);

  // Same-currency short circuit. No DB query, no API call.
  if (b === q) return 1;

  const requestedDate = normalizeDate(date);

  // Cache lookup keyed on the requested date.
  const cached = await readCachedRate(b, q, requestedDate);
  if (cached !== null) return cached;

  // Cache miss — go to Frankfurter.
  const response = await callFrankfurter(b, q, requestedDate);
  const rate = response.rates[q]!;
  const responseDate = response.date;

  // Persist under both dates: the API-reported date (canonical) and the
  // requested date (so the next lookup for the same requested date is a hit
  // even if Frankfurter rolled us back to a business day).
  const rows: FxRateRecord[] = [
    { rate_date: responseDate, base: b, quote: q, rate },
  ];
  if (responseDate !== requestedDate) {
    rows.push({ rate_date: requestedDate, base: b, quote: q, rate });
  }
  await writeCachedRates(rows);

  return rate;
}

/**
 * Bulk-prefetch today's rates for a list of pairs (used by the cron job).
 * Returns counts so the caller can report success/failure.
 */
export async function refreshTodayRates(
  pairs: Array<{ base: string; quote: string }>,
): Promise<{ ok: number; failed: number }> {
  // De-duplicate (case-insensitive) and drop identity pairs.
  const seen = new Set<string>();
  const normalized: Array<{ base: string; quote: string }> = [];
  for (const p of pairs) {
    const b = normalizeCurrency(p.base);
    const q = normalizeCurrency(p.quote);
    if (b === q) continue;
    const key = `${b}->${q}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ base: b, quote: q });
  }

  // Hard cap to stay polite with Frankfurter (<30 req/min).
  const MAX_PAIRS = 50;
  const slice = normalized.slice(0, MAX_PAIRS);

  let ok = 0;
  let failed = 0;
  // Sequential to keep the request rate gentle and predictable.
  for (const { base, quote } of slice) {
    try {
      await fetchAndCacheRate(base, quote);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error("[fx] refresh failed", {
        base,
        quote,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok, failed };
}
