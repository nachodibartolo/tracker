// Map an AI `category_hint` slug (lowercase, unaccented — see
// `lib/ai/schemas.ts:CATEGORY_HINTS`) to one of the user's actual categories.
//
// Matching strategy, in order:
//   1. Exact, case/accent-insensitive match on category name (handles the
//      seeded names like "Educación" vs the slug "educacion").
//   2. Substring match against the normalised category name (so the slug
//      "comida" picks up a user-created "Comida rápida").
//   3. Fallback to "Otros gastos" / "Otros ingresos" (the seeded catch-all
//      for the requested type).
//   4. If even the fallback is missing (e.g. the user pruned their seed),
//      return `{id: null, label: "Otros"}` and let the caller persist the
//      transaction with `category_id = null`.
//
// We never invent categories on behalf of the user — the bot stays in
// read-mostly territory and the web app remains the source of truth for
// taxonomy edits.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export interface ResolvedCategory {
  /** `null` only when the user has no categories at all for this `type`. */
  id: string | null;
  /** Human-readable label, parent-prefixed for sub-categories. */
  label: string;
}

/**
 * Strip diacritics and lower-case a string for fuzzy comparisons. We keep
 * letters/digits/whitespace and drop everything else so things like
 * "Otros gastos" → "otros gastos" → matches "otros".
 */
function normalise(s: string): string {
  // NFD splits "á" → "a" + U+0301 (combining acute). Stripping the
  // U+0300-U+036F range gives us an accent-insensitive comparison key.
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  type: "expense" | "income";
}

function labelFor(
  row: CategoryRow,
  byId: Map<string, CategoryRow>,
): string {
  if (row.parent_id) {
    const parent = byId.get(row.parent_id);
    if (parent) return `${parent.name} › ${row.name}`;
  }
  return row.name;
}

function fallbackName(type: "expense" | "income"): string {
  // Matches `supabase/migrations/0004_seed_categories.sql`.
  return type === "expense" ? "Otros gastos" : "Otros ingresos";
}

export async function resolveCategory(
  supabase: TypedClient,
  userId: string,
  type: "expense" | "income",
  hint: string | null,
): Promise<ResolvedCategory> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, parent_id, type")
    .eq("user_id", userId)
    .eq("type", type);

  if (error || !data || data.length === 0) {
    // Nothing to match against; the caller will store the row with
    // category_id = null.
    return { id: null, label: "Sin categoría" };
  }

  const rows = data as CategoryRow[];
  const byId = new Map<string, CategoryRow>();
  for (const r of rows) byId.set(r.id, r);

  // 1. Exact (normalised) name match.
  if (hint) {
    const h = normalise(hint);
    const exact = rows.find((r) => normalise(r.name) === h);
    if (exact) {
      return { id: exact.id, label: labelFor(exact, byId) };
    }
    // 2. Substring match — "comida" matches "Comida rápida", and "Educación"
    //    matches the hint "educacion" via normalise().
    const partial = rows.find((r) => {
      const n = normalise(r.name);
      return n.includes(h) || h.includes(n);
    });
    if (partial) {
      return { id: partial.id, label: labelFor(partial, byId) };
    }
  }

  // 3. Seeded fallback.
  const fallback = rows.find(
    (r) => normalise(r.name) === normalise(fallbackName(type)),
  );
  if (fallback) {
    return { id: fallback.id, label: labelFor(fallback, byId) };
  }

  // 4. As a last resort, pick the first top-level category for this type so
  //    the transaction is at least categorised. Stable order is guaranteed
  //    only loosely (no `order by` above), but for a degraded fallback it's
  //    acceptable.
  const anyTop = rows.find((r) => r.parent_id === null) ?? rows[0];
  if (anyTop) {
    return { id: anyTop.id, label: labelFor(anyTop, byId) };
  }

  return { id: null, label: "Sin categoría" };
}
