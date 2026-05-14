// Helper para resolver a qué wallet del usuario van los movimientos de un
// batch. Si el mensaje trae caption (ej: "nacion", "mp"), matchea por nombre
// de wallet — normalizado igual que `category-resolver`. Si no hay caption,
// usa la default. Si nada de eso resuelve, devuelve "ask" con candidatos.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export interface WalletCandidate {
  id: string;
  name: string;
  currency: string;
}

export type WalletResolution =
  | { kind: "resolved"; wallet: WalletCandidate }
  | { kind: "ask"; candidates: WalletCandidate[] }
  | { kind: "none" };

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export async function resolveWalletFromCaption(
  supabase: TypedClient,
  userId: string,
  caption: string | undefined | null,
  defaultWalletId: string | null,
): Promise<WalletResolution> {
  const { data, error } = await supabase
    .from("wallets")
    .select("id, name, currency")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) {
    return { kind: "none" };
  }

  const wallets = data as WalletCandidate[];
  const cap = caption ? normalise(caption) : "";

  if (cap) {
    const exact = wallets.filter((w) => normalise(w.name) === cap);
    if (exact.length === 1) return { kind: "resolved", wallet: exact[0] };

    const substring = wallets.filter((w) => {
      const n = normalise(w.name);
      return n.includes(cap) || cap.includes(n);
    });
    if (substring.length === 1) {
      return { kind: "resolved", wallet: substring[0] };
    }
    if (substring.length > 1) {
      return { kind: "ask", candidates: substring };
    }
    // Caption non-empty but no match → ask among all wallets.
    return { kind: "ask", candidates: wallets };
  }

  // No caption: try default, fall back to ask if there are multiple wallets.
  if (defaultWalletId) {
    const def = wallets.find((w) => w.id === defaultWalletId);
    if (def) return { kind: "resolved", wallet: def };
  }
  if (wallets.length === 1) {
    return { kind: "resolved", wallet: wallets[0] };
  }
  return { kind: "ask", candidates: wallets };
}
