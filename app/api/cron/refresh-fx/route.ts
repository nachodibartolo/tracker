// Vercel cron handler — refreshes today's FX rates for every currency the
// user actually holds (relative to their `main_currency`).
//
// Auth model: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
// This route returns 401 for anything missing or mismatched so it can be
// safely public-facing.

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { refreshTodayRates } from "@/lib/fx/rates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProfileRow {
  id: string;
  main_currency: string;
}

interface WalletCurrencyRow {
  user_id: string;
  currency: string;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || !auth || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Pre-provisioning safety: if Supabase isn't wired up yet, no-op cleanly
  // so cron warm-ups during scaffolding don't blow up.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (err) {
    console.error("[cron/refresh-fx] admin client init failed", err);
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Pull every profile so we can build per-user (currency -> main_currency)
  // pairs. Single-user today, generic for tomorrow.
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, main_currency");
  if (profilesError) {
    console.error("[cron/refresh-fx] failed to load profiles", profilesError);
    return NextResponse.json(
      { ok: false, error: "Failed to load profiles" },
      { status: 500 },
    );
  }

  const profileList = (profiles ?? []) as ProfileRow[];
  if (profileList.length === 0) {
    return NextResponse.json({ ok: true, fetched: 0, failed: 0 });
  }

  const userIds = profileList.map((p) => p.id);
  const { data: wallets, error: walletsError } = await supabase
    .from("wallets")
    .select("user_id, currency")
    .in("user_id", userIds)
    .eq("archived", false);
  if (walletsError) {
    console.error("[cron/refresh-fx] failed to load wallets", walletsError);
    return NextResponse.json(
      { ok: false, error: "Failed to load wallets" },
      { status: 500 },
    );
  }

  const walletList = (wallets ?? []) as WalletCurrencyRow[];

  // Build the global de-duplicated pair set across all users.
  const mainByUser = new Map<string, string>();
  for (const p of profileList) {
    mainByUser.set(p.id, p.main_currency.toUpperCase());
  }

  const pairSet = new Set<string>();
  const pairs: Array<{ base: string; quote: string }> = [];
  for (const w of walletList) {
    const main = mainByUser.get(w.user_id);
    if (!main) continue;
    const base = w.currency.toUpperCase();
    if (base === main) continue;
    const key = `${base}->${main}`;
    if (pairSet.has(key)) continue;
    pairSet.add(key);
    pairs.push({ base, quote: main });
  }

  const { ok, failed } = await refreshTodayRates(pairs);
  return NextResponse.json({ ok: true, fetched: ok, failed });
}
