import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Category,
  CategoryType,
  Database,
} from "@/lib/supabase/database.types";

export type CategoryWithChildren = Category & { children: Category[] };

export interface GroupedCategories {
  expense: CategoryWithChildren[];
  income: CategoryWithChildren[];
}

export interface FlatCategoryOption {
  id: string;
  /** Display label, with parent prefix for sub-categories (e.g. "Comida › Almuerzo"). */
  label: string;
  /** Always the leaf-row's color (used for swatches in selects). */
  color: string;
  /** Always the leaf-row's icon name. */
  icon: string;
  parent_id: string | null;
  type: CategoryType;
}

type TypedClient = SupabaseClient<Database>;

/**
 * Fetch every category for `userId`, sort by (`position`, `created_at`), and
 * build a 2-level tree partitioned by `type`. Top-level rows expose a
 * `children` array (may be empty). Orphan children — children whose parent
 * isn't present in the result set — are surfaced as top-level rows so they
 * never silently disappear from the UI.
 */
export async function getCategoriesGrouped(
  supabase: TypedClient,
  userId: string,
): Promise<GroupedCategories> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as Category[];
  return buildTree(rows);
}

/**
 * Build a flat list of selectable category options for a given `type`,
 * formatted for dropdown menus. Sub-categories are prefixed with their parent
 * name (e.g. "Comida › Almuerzo") so the select shows hierarchy at a glance.
 *
 * Used by the Transactions module (Track 3A) to populate the category
 * picker — picking a sub-category there assigns the sub-category id.
 */
export async function getFlatCategoryOptions(
  supabase: TypedClient,
  userId: string,
  type: CategoryType,
): Promise<FlatCategoryOption[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .eq("type", type)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as Category[];
  const { expense, income } = buildTree(rows);
  const tree = type === "expense" ? expense : income;

  const out: FlatCategoryOption[] = [];
  for (const top of tree) {
    out.push({
      id: top.id,
      label: top.name,
      color: top.color,
      icon: top.icon,
      parent_id: null,
      type: top.type,
    });
    for (const child of top.children) {
      out.push({
        id: child.id,
        label: `${top.name} › ${child.name}`,
        color: child.color,
        icon: child.icon,
        parent_id: top.id,
        type: child.type,
      });
    }
  }
  return out;
}

function buildTree(rows: Category[]): GroupedCategories {
  const byId = new Map<string, CategoryWithChildren>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  const expense: CategoryWithChildren[] = [];
  const income: CategoryWithChildren[] = [];

  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parent_id && byId.has(row.parent_id)) {
      // Attach to parent — clone as plain Category (drop nested children)
      // since the schema is only 2 levels deep.
      const parent = byId.get(row.parent_id)!;
      const { children: _ignored, ...leaf } = node;
      void _ignored;
      parent.children.push(leaf);
    } else {
      // Top-level — or orphaned child whose parent wasn't returned. Surface
      // it at the top so the UI never loses rows silently.
      const bucket = row.type === "income" ? income : expense;
      bucket.push(node);
    }
  }

  return { expense, income };
}
