// Dedup pairing 1:1.
//
// Para un batch recién extraído, marca cuáles items son duplicados de
// transacciones ya cargadas (o de pendings de otros batches) y a cuál
// candidato apuntan exactamente. Pairing 1:1 evita falsos positivos cuando
// hay items legítimamente repetidos el mismo día (ej: dos cafés de $5000).
//
// La consulta SQL trae candidatos de:
//   1. transactions confirmadas (mismo user/wallet, ventana ±1 día)
//   2. telegram_pending no excluidas/expiradas (mismo user/wallet, otro batch_id)
//
// La tolerancia horaria es ±1 hora. Si el item no tiene hora, matchea cualquier
// hora del día.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExpenseItem } from "@/lib/ai/schemas";
import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface DedupCandidate {
  ref_id: string;
  kind: "tx" | "pending";
  type: "expense" | "income";
  amount: number;
  occurred_at: string; // ISO timestamp
}

export interface DedupResult {
  batch_index: number;
  is_duplicate: boolean;
  duplicate_of_tx_id: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const TZ = "America/Argentina/Buenos_Aires";

function dateLocal(iso: string): string {
  // Returns YYYY-MM-DD in America/Argentina/Buenos_Aires for bucketing.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(iso));
}

function bucketKey(dateStr: string, amount: number, type: string): string {
  return `${dateStr}::${amount.toFixed(2)}::${type}`;
}

/**
 * `occurred_at` may be a real timestamp or the "noon-local" sentinel that
 * the AI extractor emits when only a date was visible (no hour). We can't
 * just compare strings — Zod accepts variant ISO representations
 * (`T12:00:00-03:00`, `T12:00:00.000-03:00`, `T15:00:00Z`, etc) — so we
 * convert to local TZ and check if it's exactly noon:00.
 */
function isNoonLocalSentinel(iso: string): boolean {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // fmt.format returns "12:00:00" (24h). We strip non-digits and compare.
  const parts = fmt.format(d);
  return parts.startsWith("12:00:00") || parts.startsWith("24:00:00"); // 24:00:00 is en-US 24h noon edge in some locales
}

/**
 * Pure function: emparejamiento 1:1 entre items y candidatos.
 *
 * Para cada item (en orden temporal), busca un candidato no consumido en
 * el mismo bucket (fecha+monto+tipo). Si el item tiene hora, exige
 * |item.time - cand.time| ≤ 1h. Cuando hace match, marca el item como
 * duplicado y consume el candidato (no se puede reusar).
 */
export function pairItems(
  items: ExpenseItem[],
  candidates: DedupCandidate[],
): DedupResult[] {
  const byBucket = new Map<string, DedupCandidate[]>();
  for (const c of candidates) {
    const key = bucketKey(dateLocal(c.occurred_at), c.amount, c.type);
    const list = byBucket.get(key) ?? [];
    list.push(c);
    byBucket.set(key, list);
  }

  // Order items so earliest extracted match consumes earliest candidate first.
  const ordered = items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const ta = a.item.occurred_at ?? "";
      const tb = b.item.occurred_at ?? "";
      return ta.localeCompare(tb);
    });

  const consumed = new Set<string>();
  const out: DedupResult[] = items.map((_, idx) => ({
    batch_index: idx,
    is_duplicate: false,
    duplicate_of_tx_id: null,
  }));

  for (const { item, idx } of ordered) {
    if (item.amount == null) continue;
    if (item.type !== "expense" && item.type !== "income") continue;
    const itemIso = item.occurred_at;
    const itemDate = itemIso ? dateLocal(itemIso) : null;
    if (!itemDate) continue;

    const bucket = byBucket.get(bucketKey(itemDate, item.amount, item.type));
    if (!bucket) continue;

    const itemHasTime = itemIso !== null && !isNoonLocalSentinel(itemIso);
    let match: DedupCandidate | undefined;

    for (const c of bucket) {
      if (consumed.has(c.ref_id)) continue;
      if (itemHasTime && itemIso) {
        const diff = Math.abs(new Date(itemIso).getTime() - new Date(c.occurred_at).getTime());
        if (diff > HOUR_MS) continue;
      }
      match = c;
      break;
    }

    if (match) {
      consumed.add(match.ref_id);
      out[idx] = {
        batch_index: idx,
        is_duplicate: true,
        duplicate_of_tx_id: match.kind === "tx" ? match.ref_id : null,
      };
    }
  }

  return out;
}

/**
 * Fetch candidates from `transactions ∪ telegram_pending` and run the
 * pairing. Returns one DedupResult per item, aligned by batch_index.
 */
export async function deduplicateBatch(
  supabase: AdminClient,
  userId: string,
  walletId: string,
  items: ExpenseItem[],
  excludeBatchId: string,
): Promise<DedupResult[]> {
  if (items.length === 0) return [];

  const dates = items
    .map((i) => i.occurred_at)
    .filter((d): d is string => typeof d === "string");
  if (dates.length === 0) {
    return items.map((_, idx) => ({
      batch_index: idx,
      is_duplicate: false,
      duplicate_of_tx_id: null,
    }));
  }
  const sorted = [...dates].sort();
  const minDate = new Date(sorted[0]);
  minDate.setUTCDate(minDate.getUTCDate() - 1);
  const maxDate = new Date(sorted[sorted.length - 1]);
  maxDate.setUTCDate(maxDate.getUTCDate() + 1);

  // Transactions
  const { data: txRows, error: txErr } = await supabase
    .from("transactions")
    .select("id, type, amount, occurred_at")
    .eq("user_id", userId)
    .eq("wallet_id", walletId)
    .in("type", ["expense", "income"])
    .gte("occurred_at", minDate.toISOString())
    .lte("occurred_at", maxDate.toISOString());

  if (txErr) {
    console.error("[telegram/dedup] tx fetch failed", txErr);
  }

  // Other pending batches.
  const { data: pendingRows, error: pErr } = await supabase
    .from("telegram_pending")
    .select("id, extraction, created_at")
    .eq("user_id", userId)
    .eq("suggested_wallet_id", walletId)
    .eq("excluded", false)
    .gt("expires_at", new Date().toISOString())
    .or(`batch_id.is.null,batch_id.neq.${excludeBatchId}`);

  if (pErr) {
    console.error("[telegram/dedup] pending fetch failed", pErr);
  }

  const candidates: DedupCandidate[] = [];
  for (const r of txRows ?? []) {
    if (r.type !== "expense" && r.type !== "income") continue;
    candidates.push({
      ref_id: r.id,
      kind: "tx",
      type: r.type,
      amount: Number(r.amount),
      occurred_at: r.occurred_at,
    });
  }
  for (const r of pendingRows ?? []) {
    const ex = r.extraction as Record<string, unknown>;
    const t = ex.type;
    const amt = ex.amount;
    const occ = ex.occurred_at ?? r.created_at;
    if ((t !== "expense" && t !== "income") || typeof amt !== "number" || typeof occ !== "string") continue;
    candidates.push({
      ref_id: r.id,
      kind: "pending",
      type: t,
      amount: amt,
      occurred_at: occ,
    });
  }

  return pairItems(items, candidates);
}
